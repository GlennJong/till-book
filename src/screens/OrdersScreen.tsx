import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, CloudOff, Undo2 } from 'lucide-react';
import { db } from '../lib/db';
import { revertOrder } from '../lib/outbox';
import { useSync } from '../lib/sync';
import type { OutboxOrder } from '../lib/types';

// 本機訂單：這台裝置結過的帳（其他裝置的訂單請看試算表的銷售紀錄）
export default function OrdersScreen() {
  const orders = useLiveQuery(() => db.outbox.orderBy('seq').reverse().toArray(), []) ?? [];
  const { syncNow } = useSync();
  const [expanded, setExpanded] = useState<string | null>(null);

  const revertedBy = new Map(orders.filter(o => o.revertOf).map(o => [o.revertOf!, o]));

  const revert = async (order: OutboxOrder) => {
    if (!window.confirm(`確定沖銷 ${order.orderNo}（$${order.finalTotal}）？庫存與營收會一併回補。`)) return;
    try {
      await revertOrder(order.orderNo);
      syncNow();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  if (orders.length === 0) return <p className="mt-10 text-center text-stone-500">這台裝置還沒有訂單</p>;

  return (
    <ul className="mx-auto flex w-full max-w-2xl flex-col gap-2 pb-4">
      {orders.map(order => {
        const reverted = revertedBy.get(order.orderNo);
        const isOpen = expanded === order.orderNo;
        return (
          <li key={order.orderNo} className={`rounded-xl bg-white ${order.revertOf ? 'border-l-4 border-rose-400' : ''}`}>
            <button onClick={() => setExpanded(isOpen ? null : order.orderNo)} className="flex w-full items-center gap-3 p-3 text-left">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-mono text-sm">
                  {order.orderNo}
                  {order.status !== 'SYNCED' && <CloudOff className="size-4 text-amber-600" aria-label="待同步" />}
                </p>
                <p className="text-sm text-stone-500">
                  {new Date(order.createdAt).toLocaleString()} · {order.paymentMethod}
                  {order.event && ` · ${order.event}`}
                  {order.revertOf && ` · 沖銷 ${order.revertOf}`}
                  {reverted && ' · 已沖銷'}
                </p>
              </div>
              <span className={`text-lg font-bold ${order.finalTotal < 0 ? 'text-rose-600' : ''} ${reverted ? 'line-through opacity-50' : ''}`}>
                ${order.finalTotal}
              </span>
              <ChevronDown className={`size-4 text-stone-400 transition ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="border-t border-stone-100 px-3 pb-3">
                <ul className="py-2 text-sm">
                  {order.lines.map((l, i) => (
                    <li key={i} className="flex justify-between py-0.5">
                      <span>
                        {l.lineType === '折扣' ? l.description : `${l.itemName} ×${l.quantity}`}
                        {l.lineType === '贈品' && '（贈）'}
                        {l.description === '手動改價' && '（改價）'}
                      </span>
                      <span>${l.subtotal}</span>
                    </li>
                  ))}
                </ul>
                {order.note && <p className="text-sm text-stone-500">備註：{order.note}</p>}
                {!order.revertOf && !reverted && (
                  <button onClick={() => revert(order)} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                    <Undo2 className="size-4" /> 沖銷這張單
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
