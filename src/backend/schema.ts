import type { SetupContext, TabDefinition } from '@glennjong/vibe-sheets';
import scriptCode from './till.gs.js?raw';

export const SHEET_PREFIX = 'till-';

// 修改 till.gs.js 後要調高版本號，App 會提示既有的表格升級腳本
export const SCRIPT_VERSION = '1.9.0';


const BUNDLE_ITEM_COUNT = 8;

// 把「分類」欄每一格以逗號拆開、去空白，攤平成一欄（LET 的 tags 變數）
const CATEGORY_OPTIONS = 'tags, FLATTEN(ARRAYFORMULA(IFERROR(TRIM(SPLIT({{商品.分類}}, ",")), "")))';
const GIFT_ITEM_COUNT = 4;
const UNCATEGORIZED = '未分類';

export const TILL_TABS: TabDefinition[] = [
  {
    name: '商品',
    columns: [
      { name: '品名', type: 'string', note: '必填，不可重複' },
      { name: '售價', type: 'number', note: '必填' },
      { name: '分類', type: 'string', note: '可以填多個，用半形逗號分隔，例如「貞貞俱樂部,貼紙」；創作者、品類、系列都可以當分類。留白會歸到「未分類」' },
      { name: '商品代碼', type: 'string', note: '留白會自動編號（1001 起）。印在條碼標籤上、掃碼時用來找商品；可以自己改，但不可重複，改了要重印標籤' },
      { name: '圖片連結', type: 'string', note: '貼上 Google Drive 分享連結（需設為「知道連結的任何人」可檢視）；留白顯示品名首字' },
      {
        name: '圖片預覽',
        type: 'string',
        note: '自動顯示「圖片連結」的圖片；顯示不出來代表連結沒有公開',
        arrayFormula:
          'ARRAYFORMULA(IF({{.圖片連結}}="", "", IFERROR(IMAGE("https://lh3.googleusercontent.com/d/" & REGEXEXTRACT({{.圖片連結}}, "[-\\w]{25,}") & "=s200-c"), "")))'
      },
      { name: '總進貨量', type: 'number', note: '手上全部的貨（跨場次共用）；補貨或再刷時直接把數字加上去。留白代表不追蹤庫存' },
      {
        name: '目前庫存',
        type: 'number',
        note: '自動計算：總進貨量 − 所有已售出數量（含贈出）',
        arrayFormula:
          'ARRAYFORMULA(IF(({{.id}}="")+({{.總進貨量}}=""), "", {{.總進貨量}} - SUMIF({{銷售紀錄.商品編號}}, {{.id}}, {{銷售紀錄.數量}})))'
      },
      {
        name: '現場數量',
        type: 'number',
        note: '選填：這次帶到現場幾件。有值時每次成交會自動扣減、沖銷時加回；場次結束可以直接清空。\n盤點後要改數字，請等 App 顯示「待同步 0 筆」再改，否則還沒送出的單會再扣一次'
      },
      { name: '備註', type: 'string', note: '給自己看的記事（例如「10/5 再刷 50 本」），系統不會讀取' }
    ],
    demoRows: [
      { 品名: '範例本子 A', 售價: 200, 分類: '本子', 商品代碼: '1001', 總進貨量: 20 },
      { 品名: '範例本子 B', 售價: 150, 分類: '本子', 商品代碼: '1002', 總進貨量: 20 },
      { 品名: '範例吊飾', 售價: 120, 分類: '吊飾', 商品代碼: '1003', 總進貨量: 30 },
      { 品名: '範例貼紙', 售價: 30, 分類: '贈品', 商品代碼: '1004', 總進貨量: 50 }
    ]
  },
  {
    name: '組合價',
    columns: [
      { name: '組合名稱', type: 'string', note: '必填' },
      { name: '組合價', type: 'number', note: '必填' },
      { name: '任選件數', type: 'number', note: '留白：品項全部都要；填 N：從品項中任選 N 件' },
      ...Array.from({ length: BUNDLE_ITEM_COUNT }, (_, i) => ({
        name: `品項 ${i + 1}`,
        type: 'string' as const,
        validation: { kind: 'listFromRange' as const, range: '{{_選單.選項}}', strict: false }
      }))
    ],
    demoRows: [{ 組合名稱: '本子任選 2 本', 組合價: 300, 任選件數: 2, '品項 1': '【分類】本子' }]
  },
  {
    name: '滿額活動',
    columns: [
      { name: '活動名稱', type: 'string', note: '必填，收銀畫面會顯示' },
      { name: '滿額門檻', type: 'number', note: '必填。達標時只給「達到的最高門檻」那一階；同門檻的多列會一起給' },
      { name: '折抵金額', type: 'number', note: '滿額折；可以和贈品一起填' },
      ...Array.from({ length: GIFT_ITEM_COUNT }, (_, i) => ({
        name: `贈品 ${i + 1}`,
        type: 'string' as const,
        note: i === 0 ? '滿額贈；同一款送 2 個就填兩格' : undefined,
        validation: { kind: 'listFromRange' as const, range: '{{商品.品名}}', strict: false }
      }))
    ],
    demoRows: [{ 活動名稱: '滿 500 送貼紙', 滿額門檻: 500, '贈品 1': '範例貼紙' }]
  },
  {
    name: '銷售紀錄',
    systemColumns: false,
    columns: [
      { name: '時間', type: 'string' },
      { name: '單號', type: 'string' },
      { name: '類型', type: 'string', note: '商品 / 贈品 / 折扣' },
      { name: '品名', type: 'string' },
      { name: '數量', type: 'number', note: '沖銷時為負' },
      { name: '定價', type: 'number' },
      { name: '成交單價', type: 'number' },
      { name: '小計', type: 'number' },
      { name: '付款方式', type: 'string' },
      { name: '場次', type: 'string', note: '下單時 App 設定的場次；沒設定時留空' },
      { name: '說明', type: 'string' },
      { name: '備註', type: 'string' },
      { name: '沖銷單號', type: 'string' },
      { name: '商品編號', type: 'string', readonly: true },
      { name: '裝置', type: 'string', note: '結帳的裝置（設定 → 裝置與邀請 取的名稱）；還沒發過邀請時留空' }
    ]
  },
  {
    // 版面由 tillSetupRequests 寫入（見 salesStatsCells）
    name: '銷量統計',
    systemColumns: false,
    frozenRows: 5,
    columns: [{ name: '場次', type: 'string' }]
  },
  {
    name: '_選單',
    hidden: true,
    systemColumns: false,
    columns: [
      {
        name: '選項',
        type: 'string',
        // 組合價「品項」下拉選單：所有品名 + 每個分類各一個「【分類】xxx」（分類以逗號拆開），去重排序
        arrayFormula: `LET(${CATEGORY_OPTIONS}, items, { {{商品.品名}}; IF(tags="", "", "【分類】"&tags) }, IFERROR(SORT(UNIQUE(FILTER(items, items<>""))), ""))`
      },
      {
        name: '場次選項',
        type: 'string',
        // 銷量統計的場次下拉：全部、未指定，加上銷售紀錄出現過的場次（最近開始的在前）
        arrayFormula:
          'LET(events, {{銷售紀錄.場次}}, used, IFERROR(UNIQUE(FILTER(events, events<>"")), ""), { "全部"; "未指定場次"; IFERROR(SORT(used, MATCH(used, events, 0), FALSE), "") })'
      },
      {
        name: '分類選項',
        type: 'string',
        // 銷量統計的分類下拉：所有分類（以逗號拆開）去重排序；有商品沒填分類時多一個「未分類」
        arrayFormula: `LET(${CATEGORY_OPTIONS}, all, { tags; IF(COUNTIFS({{商品.品名}}, "<>", {{商品.分類}}, "")>0, "${UNCATEGORIZED}", "") }, IFERROR(SORT(UNIQUE(FILTER(all, all<>""))), ""))`
      },
      {
        name: '付款方式選項',
        type: 'string',
        // 銷量統計的付款方式下拉：銷售紀錄出現過的付款方式（付款方式在 App 設定，Sheet 只看得到用過的）
        arrayFormula: 'LET(pay, {{銷售紀錄.付款方式}}, IFERROR(SORT(UNIQUE(FILTER(pay, pay<>""))), ""))'
      }
    ]
  }
];

export const ALL_EVENTS = '全部';
export const NO_EVENT = '未指定場次';
export const MATCH_ALL = '同時符合';
export const MATCH_ANY = '符合任一';

// 銷量統計第 1 列的篩選：B1 場次、D1 分類、E1 條件、G1 付款方式
// 下拉可以開「允許多重選取」，多選時格子裡是逗號分隔的值；單選也照常運作
const STATS_FILTERS = { event: 'B1', category: 'D1', mode: 'E1', payment: 'G1' };

// 下方是合計與每個商品的售出、贈出、商品金額；F 欄起是各分類總覽，J 欄起是各付款方式的實收
// 全部用 SUMPRODUCT + 遮罩計算（SUMIFS 的條件無法表達「全部，含空白」或多選）
// 分類依商品表「現在」的分類計算；組合價、滿額折是整張單的折扣，分不到分類，所以分類只算商品金額
const salesStatsCells = (resolveRange: SetupContext['resolveRange']) => {
  const r = (column: string) => resolveRange(`{{銷售紀錄.${column}}}`);
  const [event, kind, qty, subtotal, productId, payment] = ['場次', '類型', '數量', '小計', '商品編號', '付款方式'].map(r);
  const ids = resolveRange('{{商品.id}}');
  const names = resolveRange('{{商品.品名}}');
  const productCategories = `IF(${resolveRange('{{商品.分類}}')}="", "${UNCATEGORIZED}", ${resolveRange('{{商品.分類}}')})`;
  const [eventCell, categoryCell, modeCell, paymentCell] = [STATS_FILTERS.event, STATS_FILTERS.category, STATS_FILTERS.mode, STATS_FILTERS.payment].map(
    a1 => a1.replace(/([A-Z]+)(\d+)/, '$$$1$$$2')
  );
  // 篩選格的值拆成一列（1×k），和整欄比對時會自動展開成 n×k
  const picks = (cell: string) => `TRIM(SPLIT(${cell}, ","))`;
  const everyRow = (column: string) => `ARRAYFORMULA(LEN(${column})>=0)`;

  // 場次：留白或含「全部」不篩選；「未指定場次」對應空白
  const eventMask =
    `LET(ev, ${picks(eventCell)}, IF(OR(${eventCell}="", ISNUMBER(MATCH("${ALL_EVENTS}", ev, 0))), ${everyRow(event)}, ` +
    `ARRAYFORMULA(ISNUMBER(MATCH(IF(${event}="", "${NO_EVENT}", ${event}), ev, 0)))))`;
  // 付款方式：留白不篩選，多選取聯集（一張單只有一種付款方式）
  const paymentMask = `LET(pk, ${picks(paymentCell)}, IF(${paymentCell}="", ${everyRow(payment)}, ARRAYFORMULA(ISNUMBER(MATCH(${payment}, pk, 0)))))`;

  // 分類字串整理成 ",a,b,"，再用 FIND(",a,") 判斷是否含某個分類（不受正規表示式特殊字元影響）
  const tagged = (categories: string) => `ARRAYFORMULA(","&REGEXREPLACE(TRIM(${categories}), "\\s*,\\s*", ",")&",")`;
  const lineTags = tagged(`IF(${productId}="", "", IFERROR(VLOOKUP(${productId}, {${ids}, ${productCategories}}, 2, FALSE), ""))`);
  // 分類：留白不篩選；每列算出符合幾個選取的分類，「同時符合」要全部符合，「符合任一」至少一個
  const categoryMatch = (tags: string) =>
    `LET(ct, ${tags}, cp, ${picks(categoryCell)}, IF(${categoryCell}="", ${everyRow('ct')}, ` +
    `LET(hits, MMULT(ARRAYFORMULA(ISNUMBER(FIND(","&cp&",", ct))*1), SEQUENCE(COLUMNS(cp), 1, 1, 0)), ` +
    `ARRAYFORMULA(IF(${modeCell}="${MATCH_ANY}", hits>0, hits=COLUMNS(cp))))))`;
  const mask = `ARRAYFORMULA(${eventMask} * ${paymentMask} * ${categoryMatch(lineTags)})`;
  const filtered = `${categoryCell}<>""`;

  const total = (field: string, lineType?: string) =>
    `=LET(mask, ${mask}, SUMPRODUCT(mask * ${lineType ? `(${kind}="${lineType}")` : '1'}, ${field}))`;
  // 實收、折扣是整張單的金額，選了分類時不顯示
  const orderTotal = (field: string, lineType?: string) => `=IF(${filtered}, "—", ${total(field, lineType).slice(1)})`;

  const table =
    `=LET(keep, ARRAYFORMULA((${ids}<>"") * ${categoryMatch(tagged(productCategories))}), ids, FILTER(${ids}, keep), names, FILTER(${names}, keep), mask, ${mask}, ` +
    `per, LAMBDA(lineType, field, MAP(ids, LAMBDA(id, SUMPRODUCT((${productId}=id) * (${kind}=lineType) * mask, field)))), ` +
    `IFERROR(HSTACK(names, per("商品", ${qty}), per("贈品", ${qty}), per("商品", ${subtotal})), ""))`;

  // 各分類總覽：受場次、付款方式影響，不受分類篩選影響；依商品金額由高到低
  const categories = resolveRange('{{_選單.分類選項}}');
  const overview =
    `=LET(tags, FILTER(${categories}, ${categories}<>""), lineTags, ${lineTags}, mask, ARRAYFORMULA(${eventMask} * ${paymentMask} * (${kind}="商品")), ` +
    `per, LAMBDA(field, MAP(tags, LAMBDA(t, SUMPRODUCT(ISNUMBER(FIND(","&t&",", lineTags)) * mask, field)))), ` +
    `IFERROR(SORT(HSTACK(tags, per(${qty}), per(${subtotal})), 3, FALSE), ""))`;

  // 各付款方式的實收：付款方式是整張單的，只受場次影響；依實收由高到低
  const payments =
    `=LET(pay, ${payment}, mask, ${eventMask}, methods, UNIQUE(FILTER(pay, pay<>"")), ` +
    `IFERROR(SORT(HSTACK(methods, MAP(methods, LAMBDA(m, SUMPRODUCT(mask * (pay=m), ${subtotal})))), 2, FALSE), ""))`;

  return [
    ['場次', ALL_EVENTS, '分類', '', MATCH_ALL, '付款方式', ''],
    ['實收', orderTotal(subtotal), '商品金額', total(subtotal, '商品'), '折扣', orderTotal(subtotal, '折扣')],
    ['售出件數', total(qty, '商品'), '贈出件數', total(qty, '贈品')],
    [`=IF(${filtered}, "只計入符合分類的商品；實收、折扣是整張單的金額，不分分類", "")`, '', '', '', '', '一個商品有多個分類時每個分類都會算到，各列加總會大於商品金額', '', '', '', '只受場次影響'],
    ['品名', '售出', '贈出', '商品金額', '', '分類', '售出', '商品金額', '', '付款方式', '實收'],
    [table, '', '', '', '', overview, '', '', '', payments]
  ];
};

// 存成純文字的欄位：單號、編號、代碼不能被 Sheets 自動轉成數字或日期（例如吃掉開頭的 0）
const TEXT_COLUMNS: Record<string, string[]> = {
  銷售紀錄: ['單號', '場次', '沖銷單號', '商品編號'],
  商品: ['商品代碼']
};

// 改過名的欄位：舊帳本升級時把舊標題改成新名稱，不另外新增空欄（否則公式會改讀空欄）
const RENAMED_COLUMNS: Record<string, Record<string, string[]>> = {
  商品: { 總進貨量: ['備貨數量'] }
};

// 銷量統計第 1 列的篩選下拉（見 STATS_FILTERS）；不擋輸入，沒開「允許多重選取」時也可以手打「安迪, 貼紙」
const STATS_DROPDOWNS: { cell: string; range?: string; list?: string[] }[] = [
  { cell: STATS_FILTERS.event, range: '{{_選單.場次選項}}' },
  { cell: STATS_FILTERS.category, range: '{{_選單.分類選項}}' },
  { cell: STATS_FILTERS.mode, list: [MATCH_ALL, MATCH_ANY] },
  { cell: STATS_FILTERS.payment, range: '{{_選單.付款方式選項}}' }
];
const STATS_HEADER_ROW = 5;
const STATS_PROTECTION_NOTE = '銷量統計由公式產生；只有第 1 列的黃色格子（場次、分類、條件、付款方式）可以切換';

const toColumnLetter = (index: number) => {
  let letter = '';
  let n = index + 1;
  while (n > 0) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
};

// 各分頁的初始列數（含標題列）。Sheets 預設 1000 列，勾選框會讓每一列都算「有資料」，讀取變慢
// 銷售紀錄由 GAS 寫入時自動加列；_選單 維持預設，避免下拉選項的公式結果放不下
export const GRID_ROWS: Record<string, number> = { 商品: 201, 組合價: 51, 滿額活動: 51, 銷售紀錄: 101 };

const PRODUCT_ROW_HEIGHT = 56;
const IMAGE_PREVIEW_WIDTH = 64;

const cell = (value: string) =>
  value.startsWith('=') ? { userEnteredValue: { formulaValue: value } } : { userEnteredValue: { stringValue: value } };

// 商品表中不可重複的欄位：重複時標紅
const uniqueColumnRule = (sheetId: number, col: number, index: number) => {
  const letter = toColumnLetter(col);
  return {
    addConditionalFormatRule: {
      index,
      rule: {
        ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 }],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [{ userEnteredValue: `=AND($${letter}2<>"", COUNTIF($${letter}$2:$${letter}, $${letter}2)>1)` }]
          },
          format: { backgroundColor: { red: 0.98, green: 0.8, blue: 0.8 } }
        }
      }
    }
  };
};

export const tillSetupRequests = ({ sheetIds, columnIndex, resolveRange }: SetupContext): object[] => {
  // 銷量統計第 1 列可以切換的格子（A1 標記，例如 B1）
  const statsCell = (a1: string) => {
    const column = a1.charCodeAt(0) - 65;
    return { sheetId: sheetIds['銷量統計'], startRowIndex: 0, endRowIndex: 1, startColumnIndex: column, endColumnIndex: column + 1 };
  };
  const statsDropdowns = STATS_DROPDOWNS.map(d => ({
    setDataValidation: {
      range: statsCell(d.cell),
      rule: {
        condition: d.list
          ? { type: 'ONE_OF_LIST', values: d.list.map(v => ({ userEnteredValue: v })) }
          : { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `=${resolveRange(d.range!)}` }] },
        strict: false,
        showCustomUi: true
      }
    }
  }));

  const textColumns = Object.entries(TEXT_COLUMNS).flatMap(([tab, columns]) =>
    columns.map(col => ({
      repeatCell: {
        range: { sheetId: sheetIds[tab], startRowIndex: 1, startColumnIndex: columnIndex(tab, col), endColumnIndex: columnIndex(tab, col) + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    }))
  );
  const productCodeCol = columnIndex('商品', '商品代碼');

  return [
    uniqueColumnRule(sheetIds['商品'], columnIndex('商品', '品名'), 0),
    uniqueColumnRule(sheetIds['商品'], productCodeCol, 1),
    ...textColumns,
    // 商品：資料列加高、圖片預覽欄加寬，並垂直置中
    {
      updateDimensionProperties: {
        range: { sheetId: sheetIds['商品'], dimension: 'ROWS', startIndex: 1, endIndex: GRID_ROWS['商品'] },
        properties: { pixelSize: PRODUCT_ROW_HEIGHT },
        fields: 'pixelSize'
      }
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: sheetIds['商品'],
          dimension: 'COLUMNS',
          startIndex: columnIndex('商品', '圖片預覽'),
          endIndex: columnIndex('商品', '圖片預覽') + 1
        },
        properties: { pixelSize: IMAGE_PREVIEW_WIDTH },
        fields: 'pixelSize'
      }
    },
    {
      repeatCell: {
        range: { sheetId: sheetIds['商品'], startRowIndex: 1, endRowIndex: GRID_ROWS['商品'] },
        cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat.verticalAlignment'
      }
    },
    // 銷量統計的版面
    {
      updateCells: {
        start: { sheetId: sheetIds['銷量統計'], rowIndex: 0, columnIndex: 0 },
        rows: salesStatsCells(resolveRange).map(values => ({ values: values.map(cell) })),
        fields: 'userEnteredValue'
      }
    },
    ...statsDropdowns,
    ...STATS_DROPDOWNS.map(d => ({
      repeatCell: {
        range: statsCell(d.cell),
        cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.95, blue: 0.7 }, textFormat: { bold: true } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    })),
    {
      repeatCell: {
        range: { sheetId: sheetIds['銷量統計'], startRowIndex: STATS_HEADER_ROW - 1, endRowIndex: STATS_HEADER_ROW },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat'
      }
    },
    {
      addProtectedRange: {
        protectedRange: {
          range: { sheetId: sheetIds['銷量統計'] },
          unprotectedRanges: STATS_DROPDOWNS.map(d => statsCell(d.cell)),
          description: STATS_PROTECTION_NOTE,
          warningOnly: true
        }
      }
    },
    // 縮小列數（放在最後，前面套用到整欄的驗證與格式會一起被裁掉）
    ...Object.entries(GRID_ROWS).map(([tab, rowCount]) => ({
      updateSheetProperties: {
        properties: { sheetId: sheetIds[tab], gridProperties: { rowCount } },
        fields: 'gridProperties.rowCount'
      }
    })),
    // 銷售紀錄由系統寫入，手動修改時跳警告
    {
      addProtectedRange: {
        protectedRange: {
          range: { sheetId: sheetIds['銷售紀錄'] },
          description: '銷售紀錄由 Till 寫入，請勿手動修改',
          warningOnly: true
        }
      }
    }
  ];
};

// ---------- 帳本結構清單（給 GAS 自動升級舊帳本用，見 spec 3.5） ----------
// 公式保留 {{分頁.欄位}} 佔位符，由 GAS 依「實際帳本」的欄位位置解析，使用者調整過欄位順序也不會錯

const asArrayFormula = (expression: string) => (/^\s*ARRAYFORMULA\s*\(/i.test(expression) ? expression : `ARRAYFORMULA(${expression})`);

export const TILL_SCHEMA = {
  version: SCRIPT_VERSION,
  tabs: TILL_TABS.map(tab => ({
    name: tab.name,
    hidden: !!tab.hidden,
    frozenRows: tab.frozenRows ?? 1,
    system: tab.systemColumns !== false,
    stats: tab.name === '銷量統計', // 版面整張由 stats 產生
    columns: tab.columns.map(col => ({
      name: col.name,
      formerly: RENAMED_COLUMNS[tab.name]?.[col.name] ?? [],
      note: col.note ?? '',
      formula: col.arrayFormula ? `={"${col.name}"; ${asArrayFormula(col.arrayFormula)}}` : '',
      text: !!TEXT_COLUMNS[tab.name]?.includes(col.name),
      readonly: !!(col.readonly || col.arrayFormula),
      dropdown: col.validation?.kind === 'listFromRange' ? { range: col.validation.range, strict: col.validation.strict ?? true } : null
    }))
  })),
  stats: {
    tab: '銷量統計',
    cells: salesStatsCells(expression => expression),
    dropdowns: STATS_DROPDOWNS,
    headerRow: STATS_HEADER_ROW,
    protection: STATS_PROTECTION_NOTE
  }
};

// 版本號與帳本結構清單注入腳本；bootstrap 回傳版本，App 據此提示升級
export const TILL_SCRIPT = {
  code: `var TILL_SCRIPT_VERSION = '${SCRIPT_VERSION}';\nvar TILL_SCHEMA = ${JSON.stringify(TILL_SCHEMA)};\n${scriptCode}`,
  version: SCRIPT_VERSION
};
