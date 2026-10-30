import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGasEnvironment, loadTillScript, MockSheet, routeFetchTo, type GasEnvironment } from '../test/gasHarness';
import { simulateNextFailure } from './api';
import { refreshCatalog } from './catalog';
import { db } from './db';
import { availableStock, healOutbox, placeOrder, revertOrder, syncOutbox } from './outbox';
import type { OrderLine } from './types';

// 前端同步引擎 × 部署後的 GAS（vibe-sheets 基礎腳本 + till.gs.js）完整往返測試
// 重點：任何重送、斷線、當機、多分頁情境下，銷售紀錄都不能重複

const SCRIPT_URL = 'https://script.google.com/macros/s/TEST/exec';
const PRODUCT_HEADERS = ['is_enabled', '品名', '售價', '分類', '圖片連結', '圖片預覽', '備貨數量', '目前庫存', 'id', 'created_at', 'updated_at'];
const LOG_HEADERS = ['時間', '單號', '類型', '品名', '數量', '定價', '成交單價', '小計', '付款方式', '說明', '備註', '沖銷單號', '商品編號'];

let env: GasEnvironment;
let net: ReturnType<typeof routeFetchTo>['state'];

const logRows = () => env.sheets['銷售紀錄'].rows.slice(1).filter(r => r.some(v => v !== ''));
const logOrderNos = () => logRows().map(r => r[LOG_HEADERS.indexOf('單號')]);
const sheetStock = (id: string) =>
  env.sheets['商品'].rows.find(r => r[PRODUCT_HEADERS.indexOf('id')] === id)![PRODUCT_HEADERS.indexOf('目前庫存')];

const line = (productId: string, quantity: number, unitPrice = 100): OrderLine => ({
  lineType: '商品',
  productId,
  itemName: productId,
  quantity,
  listPrice: unitPrice,
  unitPrice,
  subtotal: quantity * unitPrice,
  description: ''
});

const sell = (productId: string, quantity: number) => placeOrder({ lines: [line(productId, quantity)], paymentMethod: '現金' });

const unsynced = () => db.outbox.where('status').notEqual('SYNCED').toArray();
const available = async (id: string) => availableStock(await db.products.toArray(), await unsynced()).get(id);
const makeDue = () => db.outbox.toCollection().modify({ nextRetryAt: 0 });

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));

  const product = (fields: Record<string, unknown>) => PRODUCT_HEADERS.map(h => (h in fields ? fields[h] : '')) as any[];
  const sheets = {
    商品: new MockSheet('商品', [
      PRODUCT_HEADERS.slice(),
      product({ is_enabled: true, 品名: '本子', 售價: 100, 備貨數量: 10, id: 'P1' }),
      product({ is_enabled: true, 品名: '吊飾', 售價: 50, 備貨數量: 5, id: 'P2' })
    ]),
    組合價: new MockSheet('組合價', [['is_enabled', '組合名稱', '組合價', '任選件數', '品項 1', 'id', 'created_at', 'updated_at']]),
    滿額活動: new MockSheet('滿額活動', [['is_enabled', '活動名稱', '滿額門檻', '折抵金額', '贈品 1', '贈品 2', 'id', 'created_at', 'updated_at']]),
    銷售紀錄: new MockSheet('銷售紀錄', [LOG_HEADERS.slice()])
  };
  // 模擬「目前庫存」公式
  const recalc = () => {
    const p = (h: string) => PRODUCT_HEADERS.indexOf(h);
    sheets['商品'].rows.slice(1).forEach(row => {
      const sold = sheets['銷售紀錄'].rows
        .slice(1)
        .filter(r => r[LOG_HEADERS.indexOf('商品編號')] === row[p('id')])
        .reduce((sum, r) => sum + Number(r[LOG_HEADERS.indexOf('數量')]), 0);
      row[p('目前庫存')] = Number(row[p('備貨數量')]) - sold;
    });
  };
  env = createGasEnvironment(sheets, { customCode: loadTillScript(), recalc });
  const routed = routeFetchTo(env);
  net = routed.state;
  vi.stubGlobal('fetch', routed.fetchImpl);
  await refreshCatalog(SCRIPT_URL);
});

afterEach(() => vi.unstubAllGlobals());

describe('happy path', () => {
  it('checkout reserves stock locally, sync writes once and refreshes server stock', async () => {
    const order = await sell('P1', 2);
    expect(await available('P1')).toBe(8);

    const res = await syncOutbox(SCRIPT_URL);
    expect(res).toMatchObject({ sent: 1, synced: 1 });
    expect(logOrderNos()).toEqual([order.orderNo]);
    expect(sheetStock('P1')).toBe(8);
    expect((await db.products.get('P1'))!.serverStock).toBe(8);
    expect(await available('P1')).toBe(8);
    expect((await db.outbox.get(order.orderNo))!.status).toBe('SYNCED');
  });

  it('sends everything pending in one batch, in checkout order', async () => {
    const a = await sell('P1', 1);
    const b = await sell('P2', 1);
    await syncOutbox(SCRIPT_URL);
    expect(net.requests.filter(r => r.action === 'orders')).toHaveLength(1);
    expect(logOrderNos()).toEqual([a.orderNo, b.orderNo]);
  });
});

describe('failure modes that used to cause duplicates', () => {
  it('server wrote the order but the response was lost → retry is deduplicated', async () => {
    const order = await sell('P1', 3);
    net.dropNextResponse = true;
    await expect(syncOutbox(SCRIPT_URL)).rejects.toThrow();

    // 伺服器其實已經寫入，本機仍是 PENDING 並進入退避
    expect(logOrderNos()).toEqual([order.orderNo]);
    const pending = (await db.outbox.get(order.orderNo))!;
    expect(pending).toMatchObject({ status: 'PENDING', retryCount: 1 });
    expect(pending.nextRetryAt).toBeGreaterThan(Date.now());

    await makeDue();
    await syncOutbox(SCRIPT_URL);
    expect(logOrderNos()).toEqual([order.orderNo]); // 沒有重複
    expect(sheetStock('P1')).toBe(7);
    expect(await available('P1')).toBe(7);
  });

  it('app crashed while SYNCING → heal on startup and resend without duplicates', async () => {
    const order = await sell('P1', 1);
    // 模擬：請求已送達伺服器，但 App 在收到回應前被關掉
    await db.outbox.update(order.orderNo, { status: 'SYNCING' });
    env.ctx.doPost({
      parameter: { action: 'orders' },
      postData: { contents: JSON.stringify({ orders: [{ ...order, status: undefined }] }) }
    });

    await healOutbox();
    expect((await db.outbox.get(order.orderNo))!.status).toBe('PENDING');
    await syncOutbox(SCRIPT_URL);
    expect(logOrderNos()).toEqual([order.orderNo]);
    expect((await db.outbox.get(order.orderNo))!.status).toBe('SYNCED');
  });

  it('double-triggered sync in the same tab sends the batch once', async () => {
    await sell('P1', 1);
    await sell('P1', 1);
    await Promise.all([syncOutbox(SCRIPT_URL), syncOutbox(SCRIPT_URL), syncOutbox(SCRIPT_URL)]);
    expect(net.requests.filter(r => r.action === 'orders')).toHaveLength(1);
    expect(logRows()).toHaveLength(2);
  });

  it('two tabs syncing at the same time never send the same order twice', async () => {
    await sell('P1', 1);
    await sell('P2', 2);
    // 第二個分頁：重新載入模組，擁有自己的 in-flight 狀態，但共用同一個 IndexedDB
    vi.resetModules();
    const otherTab = await import('./outbox');
    await Promise.all([syncOutbox(SCRIPT_URL), otherTab.syncOutbox(SCRIPT_URL)]);

    const sentOrderNos = net.requests
      .filter(r => r.action === 'orders')
      .flatMap(r => r.body.orders.map((o: { orderNo: string }) => o.orderNo));
    expect(new Set(sentOrderNos).size).toBe(sentOrderNos.length);
    expect(logRows()).toHaveLength(2);
  });

  it('dev failure simulator reproduces a lost response without duplicating rows', async () => {
    simulateNextFailure('drop-response');
    const order = await sell('P1', 1);
    await expect(syncOutbox(SCRIPT_URL)).rejects.toThrow('回應遺失');
    expect(logOrderNos()).toEqual([order.orderNo]);
    expect((await db.outbox.get(order.orderNo))!.status).toBe('PENDING');

    await makeDue();
    await syncOutbox(SCRIPT_URL);
    expect(logOrderNos()).toEqual([order.orderNo]);
    expect((await db.outbox.get(order.orderNo))!.status).toBe('SYNCED');
  });

  it('offline checkout keeps working and syncs later', async () => {
    net.failNextRequest = true;
    const order = await sell('P2', 1);
    await expect(syncOutbox(SCRIPT_URL)).rejects.toThrow();
    expect(await available('P2')).toBe(4);
    expect(logRows()).toHaveLength(0);

    await makeDue();
    await syncOutbox(SCRIPT_URL);
    expect(logOrderNos()).toEqual([order.orderNo]);
  });
});

describe('revert', () => {
  it('restores stock and revenue on the sheet', async () => {
    const order = await sell('P1', 4);
    await syncOutbox(SCRIPT_URL);
    const revert = await revertOrder(order.orderNo);
    expect(await available('P1')).toBe(10);
    await syncOutbox(SCRIPT_URL);

    expect(sheetStock('P1')).toBe(10);
    const subtotal = LOG_HEADERS.indexOf('小計');
    expect(logRows().reduce((sum, r) => sum + Number(r[subtotal]), 0)).toBe(0);
    expect(logRows()[1][LOG_HEADERS.indexOf('沖銷單號')]).toBe(order.orderNo);
    expect(revert.finalTotal).toBe(-400);
  });

  it('works even when the original order has not been synced yet', async () => {
    const order = await sell('P1', 1);
    await revertOrder(order.orderNo);
    await syncOutbox(SCRIPT_URL);
    expect(logOrderNos()[0]).toBe(order.orderNo); // 原單一定先寫入
    expect(sheetStock('P1')).toBe(10);
  });

  it('refuses to revert twice or to revert a revert', async () => {
    const order = await sell('P1', 1);
    const revert = await revertOrder(order.orderNo);
    await expect(revertOrder(order.orderNo)).rejects.toThrow('已經沖銷過');
    await expect(revertOrder(revert.orderNo)).rejects.toThrow('不能再被沖銷');
  });
});

describe('catalog refresh', () => {
  it('can refresh any time: available stock still subtracts only unsynced orders', async () => {
    await sell('P1', 2);
    await syncOutbox(SCRIPT_URL);
    await sell('P1', 3); // 尚未同步
    await refreshCatalog(SCRIPT_URL);
    expect((await db.products.get('P1'))!.serverStock).toBe(8);
    expect(await available('P1')).toBe(5);
  });
});
