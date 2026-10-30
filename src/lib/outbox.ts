import { callScript } from './api';
import { db } from './db';
import type { OrderLine, OutboxOrder, Product } from './types';

// 本機交易佇列（見 spec 6.2–6.4）
// 結帳只寫入 IndexedDB（毫秒級），由同步引擎批次送到 GAS；GAS 以單號做冪等防護

const ORDER_NO_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const BASE_BACKOFF_MS = 5000;

const pad = (n: number) => String(n).padStart(2, '0');

// YYMMDD-HHmmss-XXXX：人看得懂，XXXX 每張單隨機產生，避免同一秒內結帳或跨裝置撞號
export function createOrderNo(date = new Date()) {
  const random = crypto.getRandomValues(new Uint32Array(4));
  const suffix = Array.from(random, n => ORDER_NO_ALPHABET[n % ORDER_NO_ALPHABET.length]).join('');
  const day = `${String(date.getFullYear()).slice(2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${day}-${time}-${suffix}`;
}

export async function placeOrder(input: { lines: OrderLine[]; paymentMethod: string; note?: string }) {
  if (input.lines.length === 0) throw new Error('購物車是空的');
  const now = new Date();
  const order: OutboxOrder = {
    orderNo: createOrderNo(now),
    createdAt: now.toISOString(),
    seq: 0,
    status: 'PENDING',
    retryCount: 0,
    nextRetryAt: 0,
    paymentMethod: input.paymentMethod,
    note: input.note ?? '',
    lines: input.lines,
    finalTotal: input.lines.reduce((sum, l) => sum + l.subtotal, 0)
  };
  return db.transaction('rw', db.outbox, async () => {
    order.seq = await nextSeq();
    await db.outbox.add(order);
    return order;
  });
}

// 在 transaction 內取號，跨分頁也不會拿到同一個序號
const nextSeq = async () => ((await db.outbox.orderBy('seq').last())?.seq ?? 0) + 1;

// 沖銷：類似 git revert，產生一張所有數量與小計取負的新單據
export async function revertOrder(orderNo: string) {
  return db.transaction('rw', db.outbox, async () => {
    const original = await db.outbox.get(orderNo);
    if (!original) throw new Error('找不到這張單據');
    if (original.revertOf) throw new Error('沖銷單不能再被沖銷');
    const existing = await db.outbox.filter(o => o.revertOf === orderNo).first();
    if (existing) throw new Error('這張單據已經沖銷過了');

    const now = new Date();
    const revert: OutboxOrder = {
      orderNo: createOrderNo(now),
      createdAt: now.toISOString(),
      seq: await nextSeq(),
      revertOf: orderNo,
      status: 'PENDING',
      retryCount: 0,
      nextRetryAt: 0,
      paymentMethod: original.paymentMethod,
      note: original.note,
      lines: original.lines.map(l => ({ ...l, quantity: -l.quantity, subtotal: -l.subtotal })),
      finalTotal: -original.finalTotal
    };
    await db.outbox.add(revert);
    return revert;
  });
}

// 冷啟動自我修復：上次送到一半就關掉的單據，一律退回 PENDING 重送（GAS 會擋重複）
export async function healOutbox() {
  await db.outbox.where('status').equals('SYNCING').modify({ status: 'PENDING' });
}

// 可用庫存 = 伺服器庫存 − 尚未寫入試算表的單據用量
export function availableStock(products: Product[], unsynced: OutboxOrder[]) {
  const used = new Map<string, number>();
  unsynced.forEach(order =>
    order.lines.forEach(line => {
      if (line.productId) used.set(line.productId, (used.get(line.productId) ?? 0) + line.quantity);
    })
  );
  return new Map(products.map(p => [p.id, p.serverStock === null ? null : p.serverStock - (used.get(p.id) ?? 0)]));
}

interface OrdersResponse {
  success: boolean;
  error?: string;
  results: { orderNo: string; status: 'written' | 'duplicate' | 'already_reverted' | 'invalid' }[];
  stock: Record<string, number | null>;
}

export interface SyncResult {
  sent: number;
  synced: number;
  rejected: { orderNo: string; status: string }[];
}

// 同一個分頁內不重複執行；跨分頁用 Web Locks 排隊，避免兩個分頁同時送同一批單據
let inFlight: Promise<SyncResult> | null = null;

export function syncOutbox(scriptUrl: string, options: { applyStock?: boolean } = {}): Promise<SyncResult> {
  if (inFlight) return inFlight;
  const run = () => runSync(scriptUrl, options.applyStock ?? true);
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const current = (async () => (locks ? await locks.request('till-sync', run) : await run()))().finally(() => {
    inFlight = null;
  });
  inFlight = current;
  return current;
}

async function runSync(scriptUrl: string, applyStock: boolean): Promise<SyncResult> {
  const now = Date.now();
  const batch = await db.transaction('rw', db.outbox, async () => {
    const due = (await db.outbox.where('status').equals('PENDING').toArray())
      .filter(o => o.nextRetryAt <= now)
      .sort((a, b) => a.seq - b.seq);
    await Promise.all(due.map(o => db.outbox.update(o.orderNo, { status: 'SYNCING' })));
    return due;
  });
  if (batch.length === 0) return { sent: 0, synced: 0, rejected: [] };

  try {
    const res = await callScript<OrdersResponse>(scriptUrl, 'orders', {
      body: {
        orders: batch.map(o => ({
          orderNo: o.orderNo,
          createdAt: o.createdAt,
          revertOf: o.revertOf,
          paymentMethod: o.paymentMethod,
          note: o.note,
          lines: o.lines
        }))
      }
    });
    if (!res.success) throw new Error(res.error || 'SYNC_FAILED');

    const statusByNo = new Map(res.results.map(r => [r.orderNo, r.status]));
    const rejected = res.results.filter(r => r.status === 'already_reverted' || r.status === 'invalid');

    await db.transaction('rw', [db.outbox, db.products], async () => {
      for (const order of batch) {
        // 回應裡沒有的單據（理論上不會發生）退回 PENDING 下次再送
        await db.outbox.update(order.orderNo, statusByNo.has(order.orderNo) ? { status: 'SYNCED' } : { status: 'PENDING' });
      }
      // 單據轉為 SYNCED 與更新伺服器庫存放在同一個 transaction，可用庫存才不會短暫算錯
      if (applyStock) {
        for (const [id, stock] of Object.entries(res.stock || {})) {
          await db.products.update(id, { serverStock: stock });
        }
      }
    });

    return { sent: batch.length, synced: batch.filter(o => statusByNo.has(o.orderNo)).length, rejected };
  } catch (err) {
    await db.transaction('rw', db.outbox, async () => {
      for (const order of batch) {
        const retryCount = order.retryCount + 1;
        await db.outbox.update(order.orderNo, {
          status: 'PENDING',
          retryCount,
          nextRetryAt: Date.now() + Math.min(BASE_BACKOFF_MS * 2 ** (retryCount - 1), MAX_BACKOFF_MS)
        });
      }
    });
    throw err;
  }
}
