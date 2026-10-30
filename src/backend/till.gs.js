// Till 自訂 Apps Script（以 vibe-sheets 的 script.code 部署為 Custom.gs）
// 路由：GET ?action=bootstrap / ?action=summary，POST ?action=orders；VIBE_ON_EDIT 為商品自動編號
// 欄位一律以標題名稱讀取，使用者可以自由調整欄位順序或新增自己的欄位

var TILL_TABS = {
  products: '商品',
  bundles: '組合價',
  promotions: '滿額活動',
  log: '銷售紀錄'
};

/* global TILL_SCRIPT_VERSION -- 由 schema.ts 部署時注入 */
var TILL_SYSTEM_COLUMNS = ['is_enabled', 'id', 'created_at', 'updated_at'];

var VIBE_ROUTES = {
  GET: {
    bootstrap: tillBootstrap,
    summary: tillSummary
  },
  POST: {
    orders: tillPostOrders
  }
};

// ---------- 商品代碼自動編號 ----------

var TILL_FIRST_PRODUCT_CODE = 1001;

// 使用者編輯商品表後補上商品代碼（vibe-sheets 基礎腳本的 onEdit 補完系統欄位後會呼叫）
function VIBE_ON_EDIT(e) {
  if (e && e.range && e.range.getSheet().getName() === TILL_TABS.products) tillAssignProductCodes();
}

// 有品名但沒有商品代碼的列，依序編為「目前最大的數字代碼 + 1」
function tillAssignProductCodes() {
  var sheet = tillSheet(TILL_TABS.products);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  var col = tillIndexMap(values[0].map(String));
  if (col['商品代碼'] === undefined || col['品名'] === undefined) return;

  var lock = LockService.getScriptLock();
  var hasLock = lock.tryLock(5000);
  try {
    var max = TILL_FIRST_PRODUCT_CODE - 1;
    var missing = [];
    for (var i = 1; i < values.length; i++) {
      var code = tillText(values[i][col['商品代碼']]);
      if (/^\d+$/.test(code)) max = Math.max(max, Number(code));
      if (!code && tillText(values[i][col['品名']])) missing.push(i + 1);
    }
    missing.forEach(function(rowNumber) {
      var cell = sheet.getRange(rowNumber, col['商品代碼'] + 1);
      if (tillText(cell.getValue())) return; // 其他請求已經補過
      max += 1;
      cell.setValue(String(max));
    });
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

// ---------- GET ?action=bootstrap ----------

function tillBootstrap() {
  var warnings = [];

  tillAssignProductCodes();

  var seenNames = {};
  var seenCodes = {};
  var products = [];
  tillReadRecords(TILL_TABS.products).forEach(function(r) {
    var name = tillText(r['品名']);
    var price = tillNumberOrNull(r['售價']);
    if (!name) return;
    if (price === null) {
      warnings.push('商品「' + name + '」缺少售價，已略過');
      return;
    }
    if (seenNames[name]) {
      warnings.push('商品「' + name + '」品名重複，只使用第一筆');
      return;
    }
    seenNames[name] = true;
    var code = tillText(r['商品代碼']);
    if (code && seenCodes[code]) {
      warnings.push('商品代碼「' + code + '」重複（' + seenCodes[code] + '、' + name + '），掃碼時只會對應到「' + seenCodes[code] + '」');
      code = '';
    } else if (code) {
      seenCodes[code] = name;
    }
    products.push({
      id: String(r.id),
      name: name,
      price: price,
      categories: tillCategories(r['分類']),
      code: code,
      imageUrl: toLh3Url(r['圖片連結']),
      // 「總進貨量」舊版叫「備貨數量」
      totalStock: tillNumberOrNull(r['總進貨量'] !== undefined ? r['總進貨量'] : r['備貨數量']),
      currentStock: tillNumberOrNull(r['目前庫存']),
      onSite: tillNumberOrNull(r['現場數量'])
    });
  });

  var bundles = [];
  tillReadRecords(TILL_TABS.bundles).forEach(function(r) {
    var name = tillText(r['組合名稱']);
    var bundlePrice = tillNumberOrNull(r['組合價']);
    if (!name) return;
    var items = tillNumberedValues(r, '品項');
    if (bundlePrice === null) {
      warnings.push('組合「' + name + '」缺少組合價，已略過');
      return;
    }
    if (items.length === 0) {
      warnings.push('組合「' + name + '」沒有填任何品項，已略過');
      return;
    }
    bundles.push({
      name: name,
      bundlePrice: bundlePrice,
      pickCount: tillNumberOrNull(r['任選件數']),
      items: items
    });
  });

  var promotions = [];
  tillReadRecords(TILL_TABS.promotions).forEach(function(r) {
    var name = tillText(r['活動名稱']);
    var threshold = tillNumberOrNull(r['滿額門檻']);
    if (!name) return;
    var discountAmount = tillNumberOrNull(r['折抵金額']) || 0;
    var gifts = tillNumberedValues(r, '贈品');
    // 舊版欄位相容：單一「贈品」＋「贈品數量」
    var legacyQuantity = tillNumberOrNull(r['贈品數量']);
    var legacyGift = tillText(r['贈品']);
    for (var q = 1; legacyGift && q < (legacyQuantity || 1); q++) gifts.push(legacyGift);
    if (threshold === null) {
      warnings.push('活動「' + name + '」缺少滿額門檻，已略過');
      return;
    }
    if (!discountAmount && gifts.length === 0) {
      warnings.push('活動「' + name + '」沒有填折抵金額或贈品，已略過');
      return;
    }
    promotions.push({
      name: name,
      threshold: threshold,
      discountAmount: discountAmount,
      gifts: gifts
    });
  });

  return {
    products: products,
    bundles: bundles,
    promotions: promotions,
    recentEvents: tillRecentEvents(),
    warnings: warnings,
    serverTime: new Date().toISOString(),
    scriptVersion: typeof TILL_SCRIPT_VERSION === 'undefined' ? null : TILL_SCRIPT_VERSION
  };
}

// ---------- POST ?action=orders ----------

function tillPostOrders(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: 'LOCK_TIMEOUT' };

  try {
    var payload = JSON.parse(e.postData.contents);
    var orders = Array.isArray(payload.orders) ? payload.orders : [];

    var sheet = tillSheet(TILL_TABS.log);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var col = tillIndexMap(headers);

    var results = [];
    var rows = [];
    var seenOrders = {};
    var seenReverts = {};
    var onSiteDelta = {};

    orders.forEach(function(order) {
      var orderNo = order && order.orderNo ? String(order.orderNo) : '';
      if (!orderNo || !Array.isArray(order.lines) || order.lines.length === 0) {
        results.push({ orderNo: orderNo, status: 'invalid' });
        return;
      }
      if (seenOrders[orderNo] || tillColumnHas(sheet, col['單號'], orderNo)) {
        results.push({ orderNo: orderNo, status: 'duplicate' });
        return;
      }
      var revertOf = order.revertOf ? String(order.revertOf) : '';
      if (revertOf && (seenReverts[revertOf] || tillColumnHas(sheet, col['沖銷單號'], revertOf))) {
        results.push({ orderNo: orderNo, status: 'already_reverted' });
        return;
      }

      seenOrders[orderNo] = true;
      if (revertOf) seenReverts[revertOf] = true;
      order.lines.forEach(function(line) {
        rows.push(tillLogRow(headers, order, line));
        // 沖銷的數量是負的，扣減等於加回
        if (line.productId) onSiteDelta[line.productId] = (onSiteDelta[line.productId] || 0) + Number(line.quantity || 0);
      });
      results.push({ orderNo: orderNo, status: 'written' });
    });

    if (rows.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      tillEnsureRows(sheet, startRow + rows.length - 1);
      sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
      tillDeductOnSite(onSiteDelta);
      SpreadsheetApp.flush(); // 讓「目前庫存」公式重算
    }

    return { success: true, results: results, stock: tillStockMap() };
  } finally {
    lock.releaseLock();
  }
}

function tillLogRow(headers, order, line) {
  var fields = {
    '時間': new Date(order.createdAt),
    '單號': String(order.orderNo),
    '類型': line.lineType,
    '品名': line.itemName,
    '數量': line.quantity,
    '定價': line.listPrice,
    '成交單價': line.unitPrice,
    '小計': line.subtotal,
    '付款方式': order.paymentMethod || '',
    '場次': order.event || '',
    '說明': line.description || '',
    '備註': order.note || '',
    '沖銷單號': order.revertOf || '',
    '商品編號': line.productId || ''
  };
  return headers.map(function(header) {
    var value = fields[header];
    return value === undefined || value === null ? '' : value;
  });
}

// 現場數量有值的商品，依這批寫入的數量直接扣減（呼叫端已持有 Lock，重送的單號不會走到這裡）
function tillDeductOnSite(delta) {
  if (Object.keys(delta).length === 0) return;
  var sheet = tillSheet(TILL_TABS.products);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  var col = tillIndexMap(values[0].map(String));
  if (col.id === undefined || col['現場數量'] === undefined) return;

  for (var i = 1; i < values.length; i++) {
    var id = String(values[i][col.id]);
    var onSite = tillNumberOrNull(values[i][col['現場數量']]);
    if (!delta[id] || onSite === null) continue;
    // 只寫有變動的格子，不覆蓋使用者同時在改的其他格
    sheet.getRange(i + 1, col['現場數量'] + 1).setValue(onSite - delta[id]);
  }
}

function tillStockMap() {
  var stock = {};
  // 已持有 orders 的 Lock，這裡不補系統欄位（第二個參數略過補欄位流程）
  tillReadRecords(TILL_TABS.products, true).forEach(function(r) {
    if (r.id) stock[String(r.id)] = { stock: tillNumberOrNull(r['目前庫存']), onSite: tillNumberOrNull(r['現場數量']) };
  });
  return stock;
}

// 最近用過的場次名稱（新到舊、去重），給 App 自動完成；只讀「場次」欄的最後幾百列
var TILL_RECENT_EVENT_ROWS = 500;
var TILL_RECENT_EVENT_LIMIT = 10;

function tillRecentEvents() {
  var sheet = tillSheet(TILL_TABS.log);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var col = tillIndexMap(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String));
  if (col['場次'] === undefined) return [];

  var firstRow = Math.max(2, lastRow - TILL_RECENT_EVENT_ROWS + 1);
  var values = sheet.getRange(firstRow, col['場次'] + 1, lastRow - firstRow + 1, 1).getValues();
  var events = [];
  for (var i = values.length - 1; i >= 0 && events.length < TILL_RECENT_EVENT_LIMIT; i--) {
    var name = tillText(values[i][0]);
    if (name && events.indexOf(name) === -1) events.push(name);
  }
  return events;
}

// ---------- GET ?action=summary&date=YYYY-MM-DD&event=場次 ----------

function tillSummary(e) {
  var timeZone = Session.getScriptTimeZone();
  var params = e.parameter || {};
  var date = params.date || Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  var eventName = tillText(params.event);

  var day = tillSummaryTotals();
  var event = eventName ? tillSummaryTotals() : null;

  tillReadRecords(TILL_TABS.log).forEach(function(r) {
    if (event && tillText(r['場次']) === eventName) event.add(r);
    var time = r['時間'] instanceof Date ? r['時間'] : new Date(r['時間']);
    if (isNaN(time.getTime())) return;
    if (Utilities.formatDate(time, timeZone, 'yyyy-MM-dd') === date) day.add(r);
  });

  var result = day.result();
  result.date = date;
  if (event) {
    result.event = event.result();
    result.event.name = eventName;
  }
  return result;
}

function tillSummaryTotals() {
  var total = 0;
  var byPaymentMethod = {};
  var orders = {};
  var reverts = {};
  return {
    add: function(r) {
      var subtotal = tillNumberOrNull(r['小計']) || 0;
      var method = tillText(r['付款方式']) || '未指定';
      total += subtotal;
      byPaymentMethod[method] = (byPaymentMethod[method] || 0) + subtotal;
      if (tillText(r['沖銷單號'])) reverts[r['單號']] = true;
      else orders[r['單號']] = true;
    },
    result: function() {
      return {
        total: total,
        byPaymentMethod: byPaymentMethod,
        orderCount: Object.keys(orders).length,
        revertCount: Object.keys(reverts).length
      };
    }
  };
}

// ---------- 共用 ----------

function tillSheet(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('找不到分頁「' + name + '」');
  return sheet;
}

function tillIndexMap(headers) {
  var map = {};
  headers.forEach(function(header, i) {
    if (header !== '' && map[header] === undefined) map[header] = i;
  });
  return map;
}

// 讀取分頁的所有資料列（以標題為 key），略過空白列與 is_enabled 未勾選的列
// 有內容但缺 id 的列（onEdit 沒觸發到的情況）會在 Lock 內補上系統欄位
function tillReadRecords(tabName, isRetry) {
  var sheet = tillSheet(tabName);
  var values = sheet.getDataRange().getValues();
  if (values.length === 0) return [];

  var headers = values[0].map(String);
  var col = tillIndexMap(headers);
  var rows = [];
  var missingIdRows = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var hasContent = headers.some(function(header, j) {
      // 沒勾的勾選框是 FALSE，不算內容（否則空白列會被當成資料、被補上系統欄位）
      return TILL_SYSTEM_COLUMNS.indexOf(header) === -1 && row[j] !== '' && row[j] !== null && row[j] !== false;
    });
    if (!hasContent) continue;
    if (col.id !== undefined && !row[col.id]) missingIdRows.push(i + 1);
    rows.push(row);
  }

  if (missingIdRows.length > 0 && !isRetry) {
    tillFillSystemColumns(sheet, col, missingIdRows);
    SpreadsheetApp.flush();
    return tillReadRecords(tabName, true);
  }

  return rows
    .filter(function(row) { return col.is_enabled === undefined || row[col.is_enabled] === true; })
    .map(function(row) {
      var record = {};
      headers.forEach(function(header, j) {
        if (header !== '' && record[header] === undefined) record[header] = row[j];
      });
      return record;
    });
}

function tillFillSystemColumns(sheet, col, rowNumbers) {
  var lock = LockService.getScriptLock();
  var hasLock = lock.tryLock(5000);
  try {
    var now = new Date().toISOString();
    rowNumbers.forEach(function(rowNumber) {
      if (sheet.getRange(rowNumber, col.id + 1).getValue()) return; // 其他請求已經補過
      sheet.getRange(rowNumber, col.id + 1).setValue(Utilities.getUuid());
      if (col.created_at !== undefined) sheet.getRange(rowNumber, col.created_at + 1).setValue(now);
      if (col.updated_at !== undefined) sheet.getRange(rowNumber, col.updated_at + 1).setValue(now);
      if (col.is_enabled !== undefined) sheet.getRange(rowNumber, col.is_enabled + 1).setValue(true);
    });
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

// 寫入範圍超出表格列數時，先在最後加列（新列會沿用上一列的格式，例如單號的純文字格式）
function tillEnsureRows(sheet, lastRowNeeded) {
  var maxRows = sheet.getMaxRows();
  if (lastRowNeeded > maxRows) sheet.insertRowsAfter(maxRows, lastRowNeeded - maxRows);
}

function tillColumnHas(sheet, colIndex, value) {
  if (colIndex === undefined) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  return sheet.getRange(2, colIndex + 1, lastRow - 1, 1)
    .createTextFinder(value)
    .matchEntireCell(true)
    .findNext() !== null;
}

// 讀取「品項 1、品項 2…」這類編號欄位（使用者自行加的欄位也會讀到），依編號排序並略過空白
// 沒有編號的同名欄位（舊版的「贈品」）也算在內
function tillNumberedValues(record, prefix) {
  var pattern = new RegExp('^' + prefix + '\\s*\\d*$');
  return Object.keys(record)
    .filter(function(key) { return pattern.test(key); })
    .sort(function(a, b) { return Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')); })
    .map(function(key) { return tillText(record[key]); })
    .filter(function(value) { return value !== ''; });
}

// 分類可以填多個，以半形逗號分隔；留白歸到「未分類」
function tillCategories(value) {
  var categories = [];
  tillText(value).split(',').forEach(function(part) {
    var name = part.trim();
    if (name && categories.indexOf(name) === -1) categories.push(name);
  });
  return categories.length > 0 ? categories : ['未分類'];
}

function tillText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function tillNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  var n = Number(value);
  return isNaN(n) ? null : n;
}

function toLh3Url(url) {
  var match = String(url || '').match(/[-\w]{25,}/);
  return match ? 'https://lh3.googleusercontent.com/d/' + match[0] : '';
}
