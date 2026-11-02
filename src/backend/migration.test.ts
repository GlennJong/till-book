import { describe, expect, it } from 'vitest';
import { createGasEnvironment, loadTillScript, MockSheet } from '../test/gasHarness';
import { SCRIPT_VERSION } from './schema';

// 帳本結構自動升級：拿一本 1.4 版左右的舊帳本，第一次 bootstrap 時補齊欄位、分頁與公式

const oldBook = () => ({
  商品: new MockSheet('商品', [
    ['is_enabled', '品名', '售價', '分類', '圖片連結', '圖片預覽', '備貨數量', '目前庫存', '我的筆記', 'id', 'created_at', 'updated_at'],
    [true, '本子 A', 200, '本子', '', '', 10, 10, '自己加的欄', 'A', 't', 't']
  ]),
  組合價: new MockSheet('組合價', [['is_enabled', '組合名稱', '組合價', '品項 1', '品項 2', 'id', 'created_at', 'updated_at']]),
  滿額活動: new MockSheet('滿額活動', [['is_enabled', '活動名稱', '滿額門檻', '贈品', '贈品數量', 'id', 'created_at', 'updated_at']]),
  銷售紀錄: new MockSheet('銷售紀錄', [['時間', '單號', '類型', '品名', '數量', '定價', '成交單價', '小計', '付款方式', '說明', '備註', '沖銷單號', '商品編號']]),
  _選單: new MockSheet('_選單', [['選項']])
});

const setup = () => {
  const env = createGasEnvironment(oldBook(), { customCode: loadTillScript() });
  const bootstrap = () => JSON.parse(env.ctx.doGet({ parameter: { action: 'bootstrap' } }).text);
  const headers = (tab: string) => env.sheets[tab].rows[0];
  const letter = (tab: string, column: string) => String.fromCharCode(65 + headers(tab).indexOf(column));
  const formula = (tab: string, column: string) => env.sheets[tab].formulas.get(`1,${headers(tab).indexOf(column) + 1}`);
  return { env, bootstrap, headers, letter, formula };
};

describe('schema migration', () => {
  it('renames, inserts and appends missing columns without touching user data', () => {
    const { bootstrap, headers } = setup();
    const res = bootstrap();

    // 備貨數量 改名（不另開空欄）；新欄位插在 id 前；使用者自己的欄位保留
    expect(headers('商品')).toEqual([
      'is_enabled', '品名', '售價', '分類', '圖片連結', '圖片預覽', '總進貨量', '目前庫存', '我的筆記',
      '商品代碼', '現場數量', '備註', 'id', 'created_at', 'updated_at'
    ]);
    expect(headers('組合價')).toEqual([
      'is_enabled', '組合名稱', '組合價', '品項 1', '品項 2', '任選件數',
      '品項 3', '品項 4', '品項 5', '品項 6', '品項 7', '品項 8', 'id', 'created_at', 'updated_at'
    ]);
    // 沒有系統欄位的分頁加在最後；舊的「贈品」「贈品數量」留著，腳本仍然讀得到
    expect(headers('銷售紀錄').slice(-2)).toEqual(['場次', '裝置']);
    expect(headers('滿額活動')).toContain('贈品 4');
    expect(headers('_選單')).toEqual(['選項', '場次選項', '分類選項', '付款方式選項']);

    // 資料照常讀取：庫存來自改名後的欄位，商品也自動編號
    expect(res.products[0]).toMatchObject({ name: '本子 A', totalStock: 10, code: '1001' });
    expect(res.schemaChanges).toContain('「商品」欄位「備貨數量」改名為「總進貨量」');
    expect(res.schemaChanges).toContain('新增分頁「銷量統計」');
  });

  it('resolves formulas and dropdowns against the actual column positions', () => {
    const { env, bootstrap, letter, formula } = setup();
    bootstrap();

    const stockCol = letter('商品', '總進貨量');
    expect(formula('商品', '目前庫存')).toContain(`'商品'!${stockCol}2:${stockCol} - SUMIF('銷售紀錄'!${letter('銷售紀錄', '商品編號')}2:`);
    expect(formula('_選單', '分類選項')).toContain(`SPLIT('商品'!${letter('商品', '分類')}2:${letter('商品', '分類')}, ",")`);

    // 新的品項欄下拉指向 _選單 的選項
    const itemCol = env.sheets['組合價'].rows[0].indexOf('品項 3') + 1;
    const rule = env.sheets['組合價'].validations.get(`2,${itemCol}`)!;
    expect(rule.type).toBe('VALUE_IN_RANGE');
    expect((rule.values[0] as any).getA1Notation()).toBe('A2:A1000');

    // 銷量統計依舊帳本的實際位置找到「場次」（在銷售紀錄最後面）
    const stats = env.sheets['銷量統計'];
    const eventCol = letter('銷售紀錄', '場次');
    expect(stats.rows[0].slice(0, 7)).toEqual(['場次', '全部', '分類', '', '同時符合', '付款方式', '']);
    expect(stats.formulas.get('6,1')).toContain(`IF('銷售紀錄'!${eventCol}2:${eventCol}="", "未指定場次"`);
    expect(stats.validations.get('1,4')!.type).toBe('VALUE_IN_RANGE');
    expect(stats.protections[0]).toMatchObject({ warningOnly: true, unprotected: ['B1', 'D1', 'E1', 'G1'] });
  });

  it('runs once per version, and later upgrades keep the chosen filters and dropdown settings', () => {
    const { env, bootstrap } = setup();
    bootstrap();
    expect(bootstrap().schemaChanges).toEqual([]);

    // 使用者選了篩選、下拉也被調整過（例如開了多重選取）；之後的版本改了某個統計公式
    const stats = env.sheets['銷量統計'];
    stats.rows[0][1] = 'CWT70, CWT71';
    stats.rows[0][3] = '安迪';
    const dropdown = stats.validations.get('1,4');
    stats.getRange(2, 2).setFormula('=舊公式');
    env.ctx.PropertiesService.getDocumentProperties().setProperty('tillSchemaVersion', '0.0.0');

    expect(bootstrap().schemaChanges).toEqual(['更新「銷量統計」版面']);
    expect(stats.formulas.get('2,2')).not.toBe('=舊公式');
    expect(stats.rows[0][1]).toBe('CWT70, CWT71');
    expect(stats.rows[0][3]).toBe('安迪');
    expect(stats.validations.get('1,4')).toBe(dropdown);
    expect(env.ctx.PropertiesService.getDocumentProperties().getProperty('tillSchemaVersion')).toBe(SCRIPT_VERSION);
  });

  it('a failed migration is reported but does not block the register', () => {
    const { env, bootstrap } = setup();
    env.sheets['商品'].insertColumnBefore = () => {
      throw new Error('boom');
    };
    const res = bootstrap();
    expect(res.products).toHaveLength(1);
    expect(res.warnings.some((w: string) => w.includes('帳本結構自動升級失敗'))).toBe(true);
    expect(env.ctx.PropertiesService.getDocumentProperties().getProperty('tillSchemaVersion')).toBeNull();
  });
});
