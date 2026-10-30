import type { SetupContext, TabDefinition } from '@glennjong/vibe-sheets';
import scriptCode from './till.gs.js?raw';

export const SHEET_PREFIX = 'till-';

// 修改 till.gs.js 後要調高版本號，App 會提示既有的表格升級腳本
export const SCRIPT_VERSION = '1.7.0';

// 版本號注入腳本，bootstrap 會回傳，App 據此提示升級
export const TILL_SCRIPT = { code: `var TILL_SCRIPT_VERSION = '${SCRIPT_VERSION}';\n${scriptCode}`, version: SCRIPT_VERSION };

const BUNDLE_ITEM_COUNT = 8;

// 把「分類」欄每一格以逗號拆開、去空白，攤平成一欄（LET 的 tags 變數）
const CATEGORY_OPTIONS = 'tags, FLATTEN(ARRAYFORMULA(IFERROR(TRIM(SPLIT({{商品.分類}}, ",")), "")))';
const GIFT_ITEM_COUNT = 4;

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
      { name: '商品編號', type: 'string', readonly: true }
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
      }
    ]
  }
];

export const ALL_EVENTS = '全部';
export const NO_EVENT = '未指定場次';

// 銷量統計：B1 選場次，下方是整場合計與每個商品的售出、贈出、商品金額
// 全部用 SUMPRODUCT + 遮罩計算（SUMIFS 的條件無法表達「全部，含空白」）
const salesStatsCells = (resolveRange: SetupContext['resolveRange']) => {
  const r = (column: string) => resolveRange(`{{銷售紀錄.${column}}}`);
  const [event, kind, qty, subtotal, productId] = ['場次', '類型', '數量', '小計', '商品編號'].map(r);
  const mask = `ARRAYFORMULA((($B$1="${ALL_EVENTS}") + (${event}=IF($B$1="${NO_EVENT}", "", $B$1))) > 0)`;
  const total = (field: string, lineType?: string) =>
    `=LET(mask, ${mask}, SUMPRODUCT(mask * ${lineType ? `(${kind}="${lineType}")` : '1'}, ${field}))`;

  const ids = resolveRange('{{商品.id}}');
  const names = resolveRange('{{商品.品名}}');
  const table =
    `=LET(ids, FILTER(${ids}, ${ids}<>""), names, FILTER(${names}, ${ids}<>""), mask, ${mask}, ` +
    `per, LAMBDA(lineType, field, MAP(ids, LAMBDA(id, SUMPRODUCT((${productId}=id) * (${kind}=lineType) * mask, field)))), ` +
    `IFERROR(HSTACK(names, per("商品", ${qty}), per("贈品", ${qty}), per("商品", ${subtotal})), ""))`;

  return [
    ['場次', ALL_EVENTS],
    ['實收', total(subtotal), '商品金額', total(subtotal, '商品'), '折扣', total(subtotal, '折扣')],
    ['售出件數', total(qty, '商品'), '贈出件數', total(qty, '贈品')],
    [],
    ['品名', '售出', '贈出', '商品金額'],
    [table]
  ];
};

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

  // 銷售紀錄裡的單號、編號一律存成文字，避免被 Sheets 自動轉成數字或日期
  const textColumns = ['單號', '場次', '沖銷單號', '商品編號'].map(col => ({
    repeatCell: {
      range: {
        sheetId: sheetIds['銷售紀錄'],
        startRowIndex: 1,
        startColumnIndex: columnIndex('銷售紀錄', col),
        endColumnIndex: columnIndex('銷售紀錄', col) + 1
      },
      cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
      fields: 'userEnteredFormat.numberFormat'
    }
  }));

  // 商品代碼存成文字，避免被轉成數字（例如吃掉開頭的 0）
  const productCodeCol = columnIndex('商品', '商品代碼');
  const productCodeText = {
    repeatCell: {
      range: { sheetId: sheetIds['商品'], startRowIndex: 1, startColumnIndex: productCodeCol, endColumnIndex: productCodeCol + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
      fields: 'userEnteredFormat.numberFormat'
    }
  };

  return [
    uniqueColumnRule(sheetIds['商品'], columnIndex('商品', '品名'), 0),
    uniqueColumnRule(sheetIds['商品'], productCodeCol, 1),
    ...textColumns,
    productCodeText,
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
    {
      setDataValidation: {
        range: { sheetId: sheetIds['銷量統計'], startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
        rule: {
          condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `=${resolveRange('{{_選單.場次選項}}')}` }] },
          strict: true,
          showCustomUi: true
        }
      }
    },
    {
      repeatCell: {
        range: { sheetId: sheetIds['銷量統計'], startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
        cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.95, blue: 0.7 }, textFormat: { bold: true } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    {
      repeatCell: {
        range: { sheetId: sheetIds['銷量統計'], startRowIndex: 4, endRowIndex: 5 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat'
      }
    },
    {
      addProtectedRange: {
        protectedRange: {
          range: { sheetId: sheetIds['銷量統計'] },
          unprotectedRanges: [{ sheetId: sheetIds['銷量統計'], startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 }],
          description: '銷量統計由公式產生；只有 B1 的場次可以切換',
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
