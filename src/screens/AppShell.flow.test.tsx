// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGasEnvironment, loadTillScript, MockSheet, routeFetchTo, type GasEnvironment } from '../test/gasHarness';
import { db } from '../lib/db';
import AppShell from './AppShell';

// 端到端：在 jsdom 裡操作收銀畫面，驗證每個動作都正確反映到（模擬的）Google 試算表

const PRODUCT_HEADERS = ['is_enabled', '品名', '售價', '分類', '圖片連結', '圖片預覽', '備貨數量', '目前庫存', 'id', 'created_at', 'updated_at'];
const BUNDLE_HEADERS = ['is_enabled', '組合名稱', '組合價', '任選件數', '品項 1', '品項 2', 'id', 'created_at', 'updated_at'];
const PROMO_HEADERS = ['is_enabled', '活動名稱', '滿額門檻', '折抵金額', '贈品 1', '贈品 2', 'id', 'created_at', 'updated_at'];
const LOG_HEADERS = ['時間', '單號', '類型', '品名', '數量', '定價', '成交單價', '小計', '付款方式', '說明', '備註', '沖銷單號', '商品編號'];

const connection = { fileId: 'FILE', name: '測試場', scriptUrl: 'https://script.google.com/macros/s/TEST/exec' };

let env: GasEnvironment;

const row = (headers: string[], fields: Record<string, unknown>) => headers.map(h => (h in fields ? fields[h] : '')) as any[];
const log = () =>
  env.sheets['銷售紀錄'].rows.slice(1).map(r => Object.fromEntries(LOG_HEADERS.map((h, i) => [h, r[i]])) as Record<string, any>);
const stockOf = (name: string) => {
  const r = env.sheets['商品'].rows.find(x => x[1] === name)!;
  return r[PRODUCT_HEADERS.indexOf('目前庫存')];
};

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  const sheets = {
    商品: new MockSheet('商品', [
      PRODUCT_HEADERS.slice(),
      row(PRODUCT_HEADERS, { is_enabled: true, 品名: '本子 A', 售價: 200, 分類: '本子', 備貨數量: 10, id: 'A' }),
      row(PRODUCT_HEADERS, { is_enabled: true, 品名: '本子 B', 售價: 150, 分類: '本子', 備貨數量: 10, id: 'B' }),
      row(PRODUCT_HEADERS, { is_enabled: true, 品名: '貼紙', 售價: 30, 分類: '贈品', 備貨數量: 1, id: 'S' })
    ]),
    組合價: new MockSheet('組合價', [BUNDLE_HEADERS.slice(), row(BUNDLE_HEADERS, { is_enabled: true, 組合名稱: '本子任選 2', 組合價: 300, 任選件數: 2, '品項 1': '【分類】本子', id: 'b1' })]),
    滿額活動: new MockSheet('滿額活動', [PROMO_HEADERS.slice(), row(PROMO_HEADERS, { is_enabled: true, 活動名稱: '滿 300 送貼紙', 滿額門檻: 300, '贈品 1': '貼紙', id: 'm1' })]),
    銷售紀錄: new MockSheet('銷售紀錄', [LOG_HEADERS.slice()])
  };
  const recalc = () => {
    sheets['商品'].rows.slice(1).forEach(r => {
      const sold = sheets['銷售紀錄'].rows.slice(1).filter(l => l[12] === r[8]).reduce((s, l) => s + Number(l[4]), 0);
      r[PRODUCT_HEADERS.indexOf('目前庫存')] = Number(r[PRODUCT_HEADERS.indexOf('備貨數量')]) - sold;
    });
  };
  env = createGasEnvironment(sheets, { customCode: loadTillScript(), recalc });
  vi.stubGlobal('fetch', routeFetchTo(env).fetchImpl);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// 商品格子在「商品分類」之後的網格裡；以品名找到所在的按鈕
const productButton = async (name: string) => (await screen.findAllByText(name))[0].closest('button')!;
const cartPanel = () => screen.getAllByText('合計')[0].closest('div.flex.flex-col') as HTMLElement;
const tab = (label: string) => fireEvent.click(within(screen.getByRole('navigation', { name: '主選單' })).getByText(label));

describe('register flow', () => {
  it('sell with bundle + gift, then revert, all reflected on the sheet', async () => {
    render(<AppShell connection={connection} onDisconnect={() => {}} />);

    // 商品從試算表同步進來
    fireEvent.click(await productButton('本子 A'));
    fireEvent.click(await productButton('本子 B'));

    // 購物車顯示組合折抵、滿額贈與合計
    await waitFor(() => expect(within(cartPanel()).getByText('$300')).toBeTruthy());
    expect(within(cartPanel()).getByText('組合：本子任選 2')).toBeTruthy();
    expect(within(cartPanel()).getByText(/貼紙 ×1/)).toBeTruthy();

    // 結帳：LINE Pay
    fireEvent.click(within(cartPanel()).getByText('結帳'));
    fireEvent.click(await screen.findByRole('button', { name: 'LINE Pay' }));
    fireEvent.click(screen.getByRole('button', { name: '完成結帳（LINE Pay）' }));

    await waitFor(() => expect(log()).toHaveLength(4));
    expect(log().map(l => [l['類型'], l['品名'], l['數量'], l['小計'], l['付款方式']])).toEqual([
      ['商品', '本子 A', 1, 200, 'LINE Pay'],
      ['商品', '本子 B', 1, 150, 'LINE Pay'],
      ['折扣', '本子任選 2', 1, -50, 'LINE Pay'],
      ['贈品', '貼紙', 1, 0, 'LINE Pay']
    ]);
    expect(stockOf('本子 A')).toBe(9);
    expect(stockOf('貼紙')).toBe(0);
    await screen.findByText('已同步');

    // 訂單頁沖銷
    tab('訂單');
    const orderNo = log()[0]['單號'];
    fireEvent.click(await screen.findByText(orderNo));
    fireEvent.click(await screen.findByText('沖銷這張單'));
    await waitFor(() => expect(log()).toHaveLength(8));
    expect(log().slice(4).every(l => l['沖銷單號'] === orderNo)).toBe(true);
    expect(log().reduce((s, l) => s + l['小計'], 0)).toBe(0);
    expect(stockOf('本子 A')).toBe(10);
    expect(stockOf('貼紙')).toBe(1);
    expect(await screen.findByText(/已沖銷/)).toBeTruthy();
  });

  it('manual price and order-level price are written with descriptions', async () => {
    render(<AppShell connection={connection} onDisconnect={() => {}} />);
    fireEvent.click(await productButton('本子 A'));

    // 單品改價 180
    fireEvent.click(screen.getAllByRole('button', { name: '改價：本子 A' })[0]);
    const input = await screen.findByDisplayValue('200');
    fireEvent.change(input, { target: { value: '180' } });
    fireEvent.click(screen.getByRole('button', { name: '確定' }));

    // 整單改價 170、現金收 500 找 330
    fireEvent.click(within(cartPanel()).getByText('結帳'));
    fireEvent.change(await screen.findByPlaceholderText('例如 300'), { target: { value: '170' } });
    fireEvent.click(screen.getByRole('button', { name: '$500' }));
    expect(screen.getByText('找 $330')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('備註（選填，例如預購寄送資訊）'), { target: { value: '熟客' } });
    fireEvent.click(screen.getByRole('button', { name: '完成結帳（現金）' }));

    await waitFor(() => expect(log()).toHaveLength(2));
    expect(log().map(l => [l['類型'], l['定價'], l['成交單價'], l['小計'], l['說明'], l['備註']])).toEqual([
      ['商品', 200, 180, 180, '手動改價', '熟客'],
      ['折扣', 0, -10, -10, '整單改價', '熟客']
    ]);
  });

  it('summary shows today’s total from the sheet', async () => {
    render(<AppShell connection={connection} onDisconnect={() => {}} />);
    fireEvent.click(await productButton('本子 B'));
    fireEvent.click(within(cartPanel()).getByText('結帳'));
    fireEvent.click(await screen.findByRole('button', { name: '完成結帳（現金）' }));
    await waitFor(() => expect(log()).toHaveLength(1));
    await screen.findByText('已同步');

    tab('結算');
    expect(await screen.findByText(/所有裝置 1 筆/)).toBeTruthy();
    expect(screen.getAllByText('$150').length).toBeGreaterThan(0);
  });

  it('sold-out products ask before selling', async () => {
    env.sheets['商品'].rows[3][PRODUCT_HEADERS.indexOf('備貨數量')] = 0;
    env.recalc();
    render(<AppShell connection={connection} onDisconnect={() => {}} />);
    await screen.findByText('SOLD OUT');
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(await productButton('貼紙'));
    expect(screen.getByText('點商品加入購物車')).toBeTruthy();
    fireEvent.click(await productButton('貼紙'));
    expect(within(cartPanel()).getByText('貼紙')).toBeTruthy();
  });

  it('settings: add a payment method and use it at checkout', async () => {
    render(<AppShell connection={connection} onDisconnect={() => {}} />);
    tab('設定');
    fireEvent.change(await screen.findByPlaceholderText('例如：街口支付'), { target: { value: '街口支付' } });
    fireEvent.click(screen.getByRole('button', { name: '新增付款方式' }));
    await screen.findByText('街口支付');

    tab('收銀');
    fireEvent.click(await productButton('本子 A'));
    fireEvent.click(within(cartPanel()).getByText('結帳'));
    fireEvent.click(await screen.findByRole('button', { name: '街口支付' }));
    fireEvent.click(screen.getByRole('button', { name: '完成結帳（街口支付）' }));
    await waitFor(() => expect(log()[0]?.['付款方式']).toBe('街口支付'));
  });
});
