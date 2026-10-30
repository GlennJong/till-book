import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpreadsheetWithTabs } from '@glennjong/vibe-sheets';
import { TILL_SCRIPT, TILL_TABS, tillSetupRequests } from './schema';

// 攔截 vibe-sheets 送出的 Sheets API 請求，確認 Till 的分頁定義能正確展開

const capture = async () => {
  const bodies: any[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return { ok: true, json: async () => ({ spreadsheetId: 'SID', spreadsheetUrl: 'URL' }) };
  });
  await createSpreadsheetWithTabs('TOKEN', 'till-test', TILL_TABS, tillSetupRequests);
  return { create: bodies[0], setup: bodies[1] };
};

const header = (create: any, tab: string) =>
  create.sheets.find((s: any) => s.properties.title === tab).data[0].rowData[0].values;

afterEach(() => vi.unstubAllGlobals());

describe('Till schema', () => {
  it('creates the five tabs with the helper tab hidden', async () => {
    const { create } = await capture();
    expect(create.sheets.map((s: any) => [s.properties.title, s.properties.hidden])).toEqual([
      ['商品', false],
      ['組合價', false],
      ['滿額活動', false],
      ['銷售紀錄', false],
      ['_選單', true]
    ]);
  });

  it('resolves the stock formula to the right columns', async () => {
    const { create } = await capture();
    const stock = header(create, '商品').find((c: any) => c.userEnteredValue.formulaValue?.startsWith('={"目前庫存"'));
    // 商品：A is_enabled, B 品名, C 售價, D 分類, E 圖片連結, F 圖片預覽, G 備貨數量, H 目前庫存, I id
    // 銷售紀錄：E 數量, M 商品編號
    expect(stock.userEnteredValue.formulaValue).toBe(
      `={"目前庫存"; ARRAYFORMULA(IF(('商品'!I2:I="")+('商品'!G2:G=""), "", '商品'!G2:G - SUMIF('銷售紀錄'!M2:M, '商品'!I2:I, '銷售紀錄'!E2:E)))}`
    );
  });

  it('previews Drive images with IMAGE() next to the link', async () => {
    const { create } = await capture();
    const preview = header(create, '商品')[5];
    expect(preview.userEnteredValue.formulaValue).toBe(
      `={"圖片預覽"; ARRAYFORMULA(IF('商品'!E2:E="", "", IFERROR(IMAGE("https://lh3.googleusercontent.com/d/" & REGEXEXTRACT('商品'!E2:E, "[-\\w]{25,}") & "=s200-c"), "")))}`
    );
  });

  it('builds the bundle item dropdown source from product names and categories', async () => {
    const { create } = await capture();
    expect(header(create, '_選單')[0].userEnteredValue.formulaValue).toBe(
      `={"選項"; ARRAYFORMULA(LET(items, { '商品'!B2:B; ARRAYFORMULA(IF('商品'!D2:D="", "", "【分類】"&'商品'!D2:D)) }, IFERROR(SORT(UNIQUE(FILTER(items, items<>""))), "")))}`
    );
  });

  it('points dropdowns at the helper tab and product names', async () => {
    const { setup } = await capture();
    const ranges = setup.requests
      .filter((r: any) => r.setDataValidation?.rule.condition.type === 'ONE_OF_RANGE')
      .map((r: any) => [r.setDataValidation.range.sheetId, r.setDataValidation.rule.condition.values[0].userEnteredValue]);
    expect(ranges).toEqual([
      ...Array.from({ length: 8 }, () => [1, `='_選單'!A2:A`]),
      ...Array.from({ length: 4 }, () => [2, `='商品'!B2:B`])
    ]);
  });

  it('adds the duplicate-name highlight, text formats and log protection', async () => {
    const { setup } = await capture();
    const rule = setup.requests.find((r: any) => r.addConditionalFormatRule).addConditionalFormatRule.rule;
    expect(rule.booleanRule.condition.values[0].userEnteredValue).toBe('=AND($B2<>"", COUNTIF($B$2:$B, $B2)>1)');
    const textCols = setup.requests
      .filter((r: any) => r.repeatCell?.cell.userEnteredFormat.numberFormat)
      .map((r: any) => r.repeatCell.range.startColumnIndex);
    expect(textCols).toEqual([1, 11, 12]);
    expect(setup.requests.some((r: any) => r.addProtectedRange?.protectedRange.range.sheetId === 3 && !r.addProtectedRange.protectedRange.range.startColumnIndex)).toBe(true);
  });

  it('shrinks the grids, sizes product rows for image previews', async () => {
    const { setup } = await capture();
    const rowCounts = setup.requests
      .filter((r: any) => r.updateSheetProperties)
      .map((r: any) => [r.updateSheetProperties.properties.sheetId, r.updateSheetProperties.properties.gridProperties.rowCount]);
    expect(rowCounts).toEqual([[0, 201], [1, 51], [2, 51], [3, 101]]);
    // 縮小列數必須排在套用整欄驗證之後
    const lastValidation = setup.requests.findLastIndex((r: any) => r.setDataValidation);
    const firstShrink = setup.requests.findIndex((r: any) => r.updateSheetProperties);
    expect(firstShrink).toBeGreaterThan(lastValidation);

    const dims = setup.requests.filter((r: any) => r.updateDimensionProperties).map((r: any) => r.updateDimensionProperties);
    expect(dims).toEqual([
      { range: { sheetId: 0, dimension: 'ROWS', startIndex: 1, endIndex: 201 }, properties: { pixelSize: 56 }, fields: 'pixelSize' },
      { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 64 }, fields: 'pixelSize' }
    ]);
  });

  it('puts checkboxes only on demo rows, so empty rows stay empty', async () => {
    const { setup } = await capture();
    const checkboxes = setup.requests
      .filter((r: any) => r.setDataValidation?.rule.condition.type === 'BOOLEAN')
      .map((r: any) => r.setDataValidation.range)
      .map((r: any) => [r.sheetId, r.startColumnIndex, r.startRowIndex, r.endRowIndex]);
    // 商品 4 筆範例（第 2–5 列）、組合價與滿額活動各 1 筆範例（第 2 列）；只有 is_enabled 是勾選框
    expect(checkboxes).toEqual([
      [0, 0, 1, 5],
      [1, 0, 1, 2],
      [2, 0, 1, 2]
    ]);
  });

  it('ships the GAS script with a version', () => {
    expect(TILL_SCRIPT.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(TILL_SCRIPT.code).toContain('var VIBE_ROUTES');
  });
});
