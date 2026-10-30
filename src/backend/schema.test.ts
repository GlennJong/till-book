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
  it('creates the six tabs with the helper tab hidden', async () => {
    const { create } = await capture();
    expect(create.sheets.map((s: any) => [s.properties.title, s.properties.hidden])).toEqual([
      ['商品', false],
      ['組合價', false],
      ['滿額活動', false],
      ['銷售紀錄', false],
      ['銷量統計', false],
      ['_選單', true]
    ]);
  });

  it('resolves the stock formula to the right columns', async () => {
    const { create } = await capture();
    const stock = header(create, '商品').find((c: any) => c.userEnteredValue.formulaValue?.startsWith('={"目前庫存"'));
    // 商品：A is_enabled, B 品名, C 售價, D 分類, E 商品代碼, F 圖片連結, G 圖片預覽, H 總進貨量, I 目前庫存, J 現場數量, K 備註, L id
    // 銷售紀錄：E 數量, N 商品編號
    expect(stock.userEnteredValue.formulaValue).toBe(
      `={"目前庫存"; ARRAYFORMULA(IF(('商品'!L2:L="")+('商品'!H2:H=""), "", '商品'!H2:H - SUMIF('銷售紀錄'!N2:N, '商品'!L2:L, '銷售紀錄'!E2:E)))}`
    );
  });

  it('previews Drive images with IMAGE() next to the link', async () => {
    const { create } = await capture();
    const preview = header(create, '商品')[6];
    expect(preview.userEnteredValue.formulaValue).toBe(
      `={"圖片預覽"; ARRAYFORMULA(IF('商品'!F2:F="", "", IFERROR(IMAGE("https://lh3.googleusercontent.com/d/" & REGEXEXTRACT('商品'!F2:F, "[-\\w]{25,}") & "=s200-c"), "")))}`
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
      ...Array.from({ length: 4 }, () => [2, `='商品'!B2:B`]),
      [4, `='_選單'!B2:B`]
    ]);
  });

  it('adds the duplicate highlights, text formats and log protection', async () => {
    const { setup } = await capture();
    const rules = setup.requests.filter((r: any) => r.addConditionalFormatRule).map((r: any) => r.addConditionalFormatRule.rule);
    expect(rules.map((rule: any) => rule.booleanRule.condition.values[0].userEnteredValue)).toEqual([
      '=AND($B2<>"", COUNTIF($B$2:$B, $B2)>1)',
      '=AND($E2<>"", COUNTIF($E$2:$E, $E2)>1)'
    ]);
    const textCols = setup.requests
      .filter((r: any) => r.repeatCell?.cell.userEnteredFormat.numberFormat)
      .map((r: any) => [r.repeatCell.range.sheetId, r.repeatCell.range.startColumnIndex]);
    // 銷售紀錄：單號、場次、沖銷單號、商品編號；商品：商品代碼
    expect(textCols).toEqual([[3, 1], [3, 9], [3, 12], [3, 13], [0, 4]]);
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
      { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 64 }, fields: 'pixelSize' }
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

  it('lays out the sales stats tab with an event picker and formulas', async () => {
    const { setup } = await capture();
    const layout = setup.requests.find((r: any) => r.updateCells?.start.sheetId === 4).updateCells;
    const text = layout.rows.map((row: any) =>
      row.values.map((v: any) => v.userEnteredValue.stringValue ?? v.userEnteredValue.formulaValue.slice(0, 4))
    );
    expect(text).toEqual([
      ['場次', '全部'],
      ['實收', '=LET', '商品金額', '=LET', '折扣', '=LET'],
      ['售出件數', '=LET', '贈出件數', '=LET'],
      [],
      ['品名', '售出', '贈出', '商品金額'],
      ['=LET']
    ]);
    // 每個商品依 id 對應銷售紀錄（N 商品編號、C 類型、J 場次）
    const table = layout.rows[5].values[0].userEnteredValue.formulaValue;
    expect(table).toContain(`FILTER('商品'!L2:L, '商品'!L2:L<>"")`);
    expect(table).toContain(`SUMPRODUCT(('銷售紀錄'!N2:N=id) * ('銷售紀錄'!C2:C=lineType) * mask, field)`);
    expect(table).toContain(`('銷售紀錄'!J2:J=IF($B$1="未指定場次", "", $B$1))`);

    const protection = setup.requests.find((r: any) => r.addProtectedRange?.protectedRange.range.sheetId === 4).addProtectedRange.protectedRange;
    expect(protection.unprotectedRanges).toEqual([{ sheetId: 4, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 }]);
  });

  it('ships the GAS script with a version', () => {
    expect(TILL_SCRIPT.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(TILL_SCRIPT.code).toContain('var VIBE_ROUTES');
  });
});
