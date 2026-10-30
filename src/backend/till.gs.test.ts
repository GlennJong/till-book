import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

// 以記憶體中的假 SpreadsheetApp 執行 till.gs.js，驗證路由行為

type Cell = string | number | boolean | Date | null;

class MockSheet {
  rows: Cell[][];
  maxRows: number;
  constructor(public name: string, rows: Cell[][], maxRows = 1000) {
    this.rows = rows;
    this.maxRows = maxRows;
  }
  getMaxRows() {
    return this.maxRows;
  }
  insertRowsAfter(_after: number, howMany: number) {
    this.maxRows += howMany;
  }
  getLastColumn() {
    return (this.rows[0] || []).length;
  }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].some(v => v !== '' && v !== null)) return i + 1;
    }
    return 0;
  }
  getDataRange() {
    return this.getRange(1, 1, this.getLastRow(), this.getLastColumn());
  }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    const read = () =>
      Array.from({ length: numRows }, (_, r) =>
        Array.from({ length: numCols }, (_, c) => this.rows[row - 1 + r]?.[col - 1 + c] ?? '')
      );
    const write = (values: Cell[][]) => {
      if (row + values.length - 1 > this.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      values.forEach((line, r) => {
        while (this.rows.length < row + r) this.rows.push(new Array(this.getLastColumn()).fill(''));
        line.forEach((v, c) => {
          this.rows[row - 1 + r][col - 1 + c] = v;
        });
      });
    };
    return {
      getValues: read,
      getValue: () => read()[0][0],
      setValues: write,
      setValue: (v: Cell) => write([[v]]),
      createTextFinder: (text: string) => ({
        matchEntireCell: () => ({
          findNext: () => (read().some(line => line.some(v => String(v) === text)) ? {} : null)
        })
      })
    };
  }
}

const PRODUCT_HEADERS = ['is_enabled', '品名', '售價', '分類', '商品代碼', '圖片連結', '總進貨量', '目前庫存', '現場數量', '備註', 'id', 'created_at', 'updated_at'];
const BUNDLE_HEADERS = ['is_enabled', '組合名稱', '組合價', '任選件數', '品項 1', '品項 2', '品項 10', 'id', 'created_at', 'updated_at'];
const PROMO_HEADERS = ['is_enabled', '活動名稱', '滿額門檻', '折抵金額', '贈品 1', '贈品 2', 'id', 'created_at', 'updated_at'];
const LOG_HEADERS = ['時間', '單號', '類型', '品名', '數量', '定價', '成交單價', '小計', '付款方式', '場次', '說明', '備註', '沖銷單號', '商品編號'];

let sheets: Record<string, MockSheet>;
let ctx: Record<string, any>;

// 模擬「目前庫存」ARRAYFORMULA：flush 時依銷售紀錄重算
const recalcStock = () => {
  const products = sheets['商品'];
  const log = sheets['銷售紀錄'];
  const p = (h: string) => (products.rows[0] as string[]).indexOf(h);
  const l = (h: string) => LOG_HEADERS.indexOf(h);
  const total = p('總進貨量') === -1 ? p('備貨數量') : p('總進貨量');
  products.rows.slice(1).forEach(row => {
    const id = row[p('id')];
    const initial = row[total];
    if (!id || initial === '') {
      row[p('目前庫存')] = '';
      return;
    }
    const sold = log.rows
      .slice(1)
      .filter(r => r[l('商品編號')] === id)
      .reduce((sum, r) => sum + Number(r[l('數量')]), 0);
    row[p('目前庫存')] = Number(initial) - sold;
  });
};

const load = () => {
  let uuid = 0;
  ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (n: string) => sheets[n] || null }),
      flush: recalcStock
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      // 測試以 UTC+8 模擬 Asia/Taipei
      formatDate: (d: Date) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' }
  };
  createContext(ctx);
  runInContext(readFileSync(new URL('./till.gs.js', import.meta.url), 'utf8'), ctx);
  recalcStock();
};

const product = (fields: Record<string, Cell>) => PRODUCT_HEADERS.map(h => (h in fields ? fields[h] : ''));
const bundle = (fields: Record<string, Cell>) => BUNDLE_HEADERS.map(h => (h in fields ? fields[h] : ''));
const promo = (fields: Record<string, Cell>) => PROMO_HEADERS.map(h => (h in fields ? fields[h] : ''));

const order = (orderNo: string, lines: object[], extra: object = {}) => ({
  orderNo,
  createdAt: '2026-10-29T04:00:00.000Z', // 台北時間 2026-10-29 12:00
  paymentMethod: '現金',
  note: '',
  lines,
  ...extra
});
const line = (productId: string, quantity: number, unitPrice: number, extra: object = {}) => ({
  lineType: '商品',
  productId,
  itemName: productId,
  quantity,
  listPrice: unitPrice,
  unitPrice,
  subtotal: quantity * unitPrice,
  description: '',
  ...extra
});
const post = (orders: object[]) => ctx.VIBE_ROUTES.POST.orders({ postData: { contents: JSON.stringify({ orders }) } });

beforeEach(() => {
  sheets = {
    商品: new MockSheet('商品', [
      PRODUCT_HEADERS.slice(),
      product({ is_enabled: true, 品名: '本子 A', 售價: 200, 分類: '本子', 商品代碼: '1001', 總進貨量: 10, id: 'p-a' }),
      product({ is_enabled: true, 品名: '吊飾', 售價: 120, 商品代碼: '1002', id: 'p-b', 圖片連結: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing' }),
      product({ is_enabled: false, 品名: '下架品', 售價: 50, 商品代碼: '1003', id: 'p-off' })
    ]),
    組合價: new MockSheet('組合價', [
      BUNDLE_HEADERS.slice(),
      bundle({ is_enabled: true, 組合名稱: '本子任選 2', 組合價: 300, 任選件數: 2, '品項 1': '【分類】本子', '品項 10': '吊飾', id: 'b-1' })
    ]),
    滿額活動: new MockSheet('滿額活動', [
      PROMO_HEADERS.slice(),
      promo({ is_enabled: true, 活動名稱: '滿 500 送貼紙', 滿額門檻: 500, '贈品 1': '吊飾', '贈品 2': '吊飾', id: 'm-1' })
    ]),
    銷售紀錄: new MockSheet('銷售紀錄', [LOG_HEADERS.slice()])
  };
  load();
});

describe('bootstrap', () => {
  it('maps Chinese headers to English keys and filters disabled rows', () => {
    const res = ctx.VIBE_ROUTES.GET.bootstrap({ parameter: {} });
    expect(res.products).toEqual([
      { id: 'p-a', name: '本子 A', price: 200, category: '本子', code: '1001', imageUrl: '', totalStock: 10, currentStock: 10, onSite: null },
      {
        id: 'p-b',
        name: '吊飾',
        price: 120,
        category: '未分類',
        code: '1002',
        imageUrl: 'https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
        totalStock: null,
        currentStock: null,
        onSite: null
      }
    ]);
    expect(res.warnings).toEqual([]);
    expect(res.recentEvents).toEqual([]);
  });

  it('still reads stock from sheets created with the old 備貨數量 column', () => {
    const legacy = ['is_enabled', '品名', '售價', '備貨數量', '目前庫存', 'id'];
    sheets['商品'] = new MockSheet('商品', [legacy, [true, '本子', 100, 8, '', 'old-1']]);
    load();
    const res = ctx.VIBE_ROUTES.GET.bootstrap({ parameter: {} });
    expect(res.products[0]).toMatchObject({ totalStock: 8, currentStock: 8, onSite: null });
  });

  it('numbers products without a code after the highest numeric code, including disabled rows', () => {
    sheets['商品'].rows[2][PRODUCT_HEADERS.indexOf('商品代碼')] = 'ABC';
    sheets['商品'].rows.push(product({ is_enabled: true, 品名: '新品 1', 售價: 80, id: 'p-n1' }));
    sheets['商品'].rows.push(product({ is_enabled: true, 品名: '新品 2', 售價: 80, id: 'p-n2' }));
    sheets['商品'].rows.push(product({ is_enabled: true, 售價: 80, id: 'p-noname' }));
    const res = ctx.VIBE_ROUTES.GET.bootstrap({ parameter: {} });
    const codes = sheets['商品'].rows.slice(1).map(r => r[PRODUCT_HEADERS.indexOf('商品代碼')]);
    // 下架品的 1003 也算在內；自訂的非數字代碼保留；沒有品名的列不編號
    expect(codes).toEqual(['1001', 'ABC', '1003', '1004', '1005', '']);
    expect(res.products.map((p: { code: string }) => p.code)).toEqual(['1001', 'ABC', '1004', '1005']);
  });

  it('starts numbering at 1001 and also runs from the onEdit hook', () => {
    sheets['商品'].rows.forEach((r, i) => i > 0 && (r[PRODUCT_HEADERS.indexOf('商品代碼')] = ''));
    const sheet = sheets['商品'];
    ctx.VIBE_ON_EDIT({ range: { getSheet: () => ({ getName: () => '商品' }) } });
    expect(sheet.rows.slice(1).map(r => r[PRODUCT_HEADERS.indexOf('商品代碼')])).toEqual(['1001', '1002', '1003']);

    // 其他分頁的編輯不處理
    sheet.rows[1][PRODUCT_HEADERS.indexOf('商品代碼')] = '';
    ctx.VIBE_ON_EDIT({ range: { getSheet: () => ({ getName: () => '組合價' }) } });
    expect(sheet.rows[1][PRODUCT_HEADERS.indexOf('商品代碼')]).toBe('');
  });

  it('warns about duplicate codes and keeps only the first product on that code', () => {
    sheets['商品'].rows[2][PRODUCT_HEADERS.indexOf('商品代碼')] = '1001';
    const res = ctx.VIBE_ROUTES.GET.bootstrap({ parameter: {} });
    expect(res.products.map((p: { code: string }) => p.code)).toEqual(['1001', '']);
    expect(res.warnings).toEqual(['商品代碼「1001」重複（本子 A、吊飾），掃碼時只會對應到「本子 A」']);
  });

  it('lists recent events newest first without duplicates', () => {
    post([
      order('NO-1', [line('p-a', 1, 200)], { event: 'FF44' }),
      order('NO-2', [line('p-a', 1, 200)], { event: 'CWT70' }),
      order('NO-3', [line('p-a', 1, 200)]),
      order('NO-4', [line('p-a', 1, 200), line('p-b', 1, 120)], { event: 'FF45' }),
      order('NO-5', [line('p-a', 1, 200)], { event: 'CWT70' })
    ]);
    expect(ctx.VIBE_ROUTES.GET.bootstrap({ parameter: {} }).recentEvents).toEqual(['CWT70', 'FF45', 'FF44']);
  });

  it('collects bundle items in numeric order, including user-added columns', () => {
    const res = ctx.VIBE_ROUTES.GET.bootstrap({ parameter: {} });
    expect(res.bundles).toEqual([{ name: '本子任選 2', bundlePrice: 300, pickCount: 2, items: ['【分類】本子', '吊飾'] }]);
  });

  it('applies promotion defaults', () => {
    const res = ctx.VIBE_ROUTES.GET.bootstrap({ parameter: {} });
    expect(res.promotions).toEqual([
      { name: '滿 500 送貼紙', threshold: 500, discountAmount: 0, gifts: ['吊飾', '吊飾'] }
    ]);
  });

  it('still reads promotions from sheets created with older columns', () => {
    sheets['滿額活動'] = new MockSheet('滿額活動', [
      ['is_enabled', '活動名稱', '滿額門檻', '折抵金額', '贈品', '贈品數量', '只送最好的', 'id'],
      [true, '滿 500 送兩張貼紙', 500, '', '貼紙', 2, true, 'old-1']
    ]);
    const res = ctx.VIBE_ROUTES.GET.bootstrap({ parameter: {} });
    expect(res.promotions).toEqual([{ name: '滿 500 送兩張貼紙', threshold: 500, discountAmount: 0, gifts: ['貼紙', '貼紙'] }]);
  });

  it('does not treat empty rows with unchecked checkboxes as data', () => {
    // 使用者自己加的勾選框欄，空白列的值是 FALSE
    sheets['滿額活動'] = new MockSheet('滿額活動', [
      ['is_enabled', '活動名稱', '滿額門檻', '自訂勾選', 'id', 'created_at', 'updated_at'],
      [true, '滿 100 折 10', 100, false, 'm-1', 't', 't'],
      [false, '', '', false, '', '', ''],
      [false, '', '', false, '', '', '']
    ]);
    ctx.VIBE_ROUTES.GET.bootstrap({ parameter: {} });
    expect(sheets['滿額活動'].rows.slice(2).map(r => r[4])).toEqual(['', '']);
  });

  it('backfills system columns for rows the onEdit trigger missed', () => {
    sheets['商品'].rows.push(product({ is_enabled: false, 品名: '新商品', 售價: 80, 總進貨量: 5 }));
    const res = ctx.VIBE_ROUTES.GET.bootstrap({ parameter: {} });
    const added = res.products.find((p: { name: string }) => p.name === '新商品');
    expect(added).toMatchObject({ id: 'uuid-1', currentStock: 5 });
    const row = sheets['商品'].rows[4];
    expect(row[PRODUCT_HEADERS.indexOf('is_enabled')]).toBe(true);
    expect(row[PRODUCT_HEADERS.indexOf('created_at')]).not.toBe('');
  });

  it('warns about incomplete or duplicate rows instead of failing', () => {
    sheets['商品'].rows.push(product({ is_enabled: true, 品名: '沒價格', id: 'p-x' }));
    sheets['商品'].rows.push(product({ is_enabled: true, 品名: '本子 A', 售價: 1, id: 'p-dup' }));
    sheets['組合價'].rows.push(bundle({ is_enabled: true, 組合名稱: '空組合', 組合價: 100, id: 'b-2' }));
    sheets['滿額活動'].rows.push(promo({ is_enabled: true, 活動名稱: '什麼都沒有', 滿額門檻: 100, id: 'm-2' }));
    const res = ctx.VIBE_ROUTES.GET.bootstrap({ parameter: {} });
    expect(res.products.map((p: { id: string }) => p.id)).toEqual(['p-a', 'p-b']);
    expect(res.warnings).toEqual([
      '商品「沒價格」缺少售價，已略過',
      '商品「本子 A」品名重複，只使用第一筆',
      '組合「空組合」沒有填任何品項，已略過',
      '活動「什麼都沒有」沒有填折抵金額或贈品，已略過'
    ]);
  });
});

describe('orders', () => {
  it('writes lines by header name and returns fresh stock', () => {
    const res = post([order('251029-120000-ABCD', [line('p-a', 2, 200)])]);
    expect(res).toEqual({
      success: true,
      results: [{ orderNo: '251029-120000-ABCD', status: 'written' }],
      stock: { 'p-a': { stock: 8, onSite: null }, 'p-b': { stock: null, onSite: null } }
    });
    const written = sheets['銷售紀錄'].rows[1];
    expect(written[LOG_HEADERS.indexOf('單號')]).toBe('251029-120000-ABCD');
    expect(written[LOG_HEADERS.indexOf('小計')]).toBe(400);
    // vm 內建立的 Date 屬於另一個 realm，用 toString tag 判斷
    expect(Object.prototype.toString.call(written[LOG_HEADERS.indexOf('時間')])).toBe('[object Date]');
  });

  it('is idempotent across requests and within one batch', () => {
    const o = order('NO-1', [line('p-a', 1, 200)]);
    post([o]);
    const res = post([o, order('NO-2', [line('p-a', 1, 200)]), order('NO-2', [line('p-a', 1, 200)])]);
    expect(res.results).toEqual([
      { orderNo: 'NO-1', status: 'duplicate' },
      { orderNo: 'NO-2', status: 'written' },
      { orderNo: 'NO-2', status: 'duplicate' }
    ]);
    expect(sheets['銷售紀錄'].getLastRow()).toBe(3);
    expect(res.stock['p-a'].stock).toBe(8);
  });

  it('reverts restore stock and cannot be applied twice', () => {
    post([order('NO-1', [line('p-a', 3, 200)])]);
    const revert = (no: string) => order(no, [line('p-a', -3, 200)], { revertOf: 'NO-1' });
    const res = post([revert('R-1'), revert('R-2')]);
    expect(res.results.map((r: { status: string }) => r.status)).toEqual(['written', 'already_reverted']);
    expect(res.stock['p-a'].stock).toBe(10);
    expect(post([revert('R-3')]).results[0].status).toBe('already_reverted');
  });

  it('records the event on every line', () => {
    post([order('NO-1', [line('p-a', 1, 200), line('p-b', 1, 120)], { event: 'CWT70' }), order('NO-2', [line('p-a', 1, 200)])]);
    expect(sheets['銷售紀錄'].rows.slice(1).map(r => r[LOG_HEADERS.indexOf('場次')])).toEqual(['CWT70', 'CWT70', '']);
  });

  it('deducts on-site quantity together with stock, and reverts add it back', () => {
    const onSite = (id: string) => sheets['商品'].rows.find(r => r[PRODUCT_HEADERS.indexOf('id')] === id)![PRODUCT_HEADERS.indexOf('現場數量')];
    sheets['商品'].rows[1][PRODUCT_HEADERS.indexOf('現場數量')] = 4;

    const sale = order('NO-1', [line('p-a', 3, 200), line('p-b', 1, 120), { ...line('p-a', 1, 0), lineType: '贈品' }]);
    const res = post([sale]);
    expect(res.stock['p-a']).toEqual({ stock: 6, onSite: 0 });
    // 留白的現場數量不追蹤，不會被寫成負數
    expect(onSite('p-b')).toBe('');
    expect(res.stock['p-b']).toEqual({ stock: null, onSite: null });

    // 重送不重複扣
    post([sale]);
    expect(onSite('p-a')).toBe(0);

    // 扣到負數照樣記錄
    post([order('NO-2', [line('p-a', 2, 200)])]);
    expect(onSite('p-a')).toBe(-2);

    post([order('R-1', [line('p-a', -3, 200), line('p-b', -1, 120), { ...line('p-a', -1, 0), lineType: '贈品' }], { revertOf: 'NO-1' })]);
    expect(onSite('p-a')).toBe(2);
    expect(onSite('p-b')).toBe('');
  });

  it('adds rows when the sales log grid is full instead of failing', () => {
    sheets['銷售紀錄'] = new MockSheet('銷售紀錄', [LOG_HEADERS.slice()], 2);
    load();
    const res = post([order('NO-1', [line('p-a', 1, 200), line('p-b', 1, 120), line('p-a', 1, 200)])]);
    expect(res.results[0].status).toBe('written');
    expect(sheets['銷售紀錄'].getMaxRows()).toBe(4);
    expect(sheets['銷售紀錄'].getLastRow()).toBe(4);
  });

  it('marks malformed orders as invalid', () => {
    const res = post([{ orderNo: 'X', lines: [] }, { lines: [line('p-a', 1, 1)] }]);
    expect(res.results).toEqual([
      { orderNo: 'X', status: 'invalid' },
      { orderNo: '', status: 'invalid' }
    ]);
  });
});

describe('summary', () => {
  it('totals the day by payment method, netting out reverts', () => {
    post([
      order('NO-1', [line('p-a', 2, 200)]),
      order('NO-2', [line('p-b', 1, 120)], { paymentMethod: 'LINE Pay' }),
      order('NO-3', [line('p-a', 1, 200)], { createdAt: '2026-10-30T04:00:00.000Z' })
    ]);
    post([order('R-1', [line('p-a', -2, 200)], { revertOf: 'NO-1' })]);
    const res = ctx.VIBE_ROUTES.GET.summary({ parameter: { date: '2026-10-29' } });
    expect(res).toEqual({ date: '2026-10-29', total: 120, byPaymentMethod: { 現金: 0, 'LINE Pay': 120 }, orderCount: 2, revertCount: 1 });
  });

  it('also totals the whole event across days when asked', () => {
    post([
      order('NO-1', [line('p-a', 1, 200)], { event: 'CWT70' }),
      order('NO-2', [line('p-b', 1, 120)], { event: 'CWT70', createdAt: '2026-10-30T04:00:00.000Z' }),
      order('NO-3', [line('p-a', 1, 200)])
    ]);
    const res = ctx.VIBE_ROUTES.GET.summary({ parameter: { date: '2026-10-29', event: 'CWT70' } });
    expect(res.total).toBe(400);
    expect(res.event).toEqual({ name: 'CWT70', total: 320, byPaymentMethod: { 現金: 320 }, orderCount: 2, revertCount: 0 });
  });
});
