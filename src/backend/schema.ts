import type { SetupContext, TabDefinition } from '@glennjong/vibe-sheets';
import scriptCode from './till.gs.js?raw';

export const SHEET_PREFIX = 'till-';

// 修改 till.gs.js 後要調高版本號，App 會提示既有的表格升級腳本
export const SCRIPT_VERSION = '1.4.0';

// 版本號注入腳本，bootstrap 會回傳，App 據此提示升級
export const TILL_SCRIPT = { code: `var TILL_SCRIPT_VERSION = '${SCRIPT_VERSION}';\n${scriptCode}`, version: SCRIPT_VERSION };

const BUNDLE_ITEM_COUNT = 8;
const GIFT_ITEM_COUNT = 4;

export const TILL_TABS: TabDefinition[] = [
  {
    name: '商品',
    columns: [
      { name: '品名', type: 'string', note: '必填，不可重複' },
      { name: '售價', type: 'number', note: '必填' },
      { name: '分類', type: 'string', note: '留白會歸到「未分類」' },
      { name: '圖片連結', type: 'string', note: '貼上 Google Drive 分享連結（需設為「知道連結的任何人」可檢視）；留白顯示品名首字' },
      {
        name: '圖片預覽',
        type: 'string',
        note: '自動顯示「圖片連結」的圖片；顯示不出來代表連結沒有公開',
        arrayFormula:
          'ARRAYFORMULA(IF({{.圖片連結}}="", "", IFERROR(IMAGE("https://lh3.googleusercontent.com/d/" & REGEXEXTRACT({{.圖片連結}}, "[-\\w]{25,}") & "=s200-c"), "")))'
      },
      { name: '備貨數量', type: 'number', note: '這次帶了幾件；留白代表不追蹤庫存' },
      {
        name: '目前庫存',
        type: 'number',
        note: '自動計算：備貨數量 − 已售出數量',
        arrayFormula:
          'ARRAYFORMULA(IF(({{.id}}="")+({{.備貨數量}}=""), "", {{.備貨數量}} - SUMIF({{銷售紀錄.商品編號}}, {{.id}}, {{銷售紀錄.數量}})))'
      }
    ],
    demoRows: [
      { 品名: '範例本子 A', 售價: 200, 分類: '本子', 備貨數量: 20 },
      { 品名: '範例本子 B', 售價: 150, 分類: '本子', 備貨數量: 20 },
      { 品名: '範例吊飾', 售價: 120, 分類: '吊飾', 備貨數量: 30 },
      { 品名: '範例貼紙', 售價: 30, 分類: '贈品', 備貨數量: 50 }
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
      { name: '說明', type: 'string' },
      { name: '備註', type: 'string' },
      { name: '沖銷單號', type: 'string' },
      { name: '商品編號', type: 'string', readonly: true }
    ]
  },
  {
    name: '_選單',
    hidden: true,
    systemColumns: false,
    columns: [
      {
        name: '選項',
        type: 'string',
        // 組合價「品項」下拉選單：所有品名 + 「【分類】xxx」，去重排序
        arrayFormula:
          'LET(items, { {{商品.品名}}; ARRAYFORMULA(IF({{商品.分類}}="", "", "【分類】"&{{商品.分類}})) }, IFERROR(SORT(UNIQUE(FILTER(items, items<>""))), ""))'
      }
    ]
  }
];

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

export const tillSetupRequests = ({ sheetIds, columnIndex }: SetupContext): object[] => {
  const nameCol = columnIndex('商品', '品名');
  const nameLetter = toColumnLetter(nameCol);

  // 銷售紀錄裡的單號、編號一律存成文字，避免被 Sheets 自動轉成數字或日期
  const textColumns = ['單號', '沖銷單號', '商品編號'].map(col => ({
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

  return [
    // 品名重複時標紅
    {
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId: sheetIds['商品'], startRowIndex: 1, startColumnIndex: nameCol, endColumnIndex: nameCol + 1 }],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [{ userEnteredValue: `=AND($${nameLetter}2<>"", COUNTIF($${nameLetter}$2:$${nameLetter}, $${nameLetter}2)>1)` }]
            },
            format: { backgroundColor: { red: 0.98, green: 0.8, blue: 0.8 } }
          }
        }
      }
    },
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
