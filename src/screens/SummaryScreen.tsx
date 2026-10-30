import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw } from 'lucide-react';
import { callScript } from '../lib/api';
import { db } from '../lib/db';
import { toDateKey, useCurrentEvent } from '../lib/event';
import type { OutboxOrder } from '../lib/types';

interface Totals {
  total: number;
  byPaymentMethod: Record<string, number>;
  orderCount: number;
  revertCount: number;
}

interface SummaryResponse extends Totals {
  date: string;
  event?: Totals & { name: string };
}

const isToday = (iso: string) => toDateKey(new Date(iso)) === toDateKey(new Date());

// 今日收入與本場次收入：試算表的加總（所有裝置）＋本機還沒同步的單據
export default function SummaryScreen({ scriptUrl }: { scriptUrl: string }) {
  const { active } = useCurrentEvent();
  const eventName = active?.name ?? '';
  const [server, setServer] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  const orders = useLiveQuery(() => db.outbox.toArray(), []) ?? [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { date: toDateKey(new Date()) };
      if (eventName) params.event = eventName;
      setServer(await callScript<SummaryResponse>(scriptUrl, 'summary', { params }));
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [scriptUrl, eventName]);

  useEffect(() => {
    load();
  }, [load]);

  const online = !offline && !!server;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <TotalsCard
        title={`今日收入 ${toDateKey(new Date())}`}
        server={online ? server : null}
        localOrders={orders.filter(o => isToday(o.createdAt))}
        empty="今天還沒有收入"
      />

      {eventName && (
        <TotalsCard
          title={`本場次 ${eventName}`}
          // 伺服器版本早於 1.5.0 時沒有 event，只能顯示本機資料
          server={online ? server.event ?? null : null}
          localOrders={orders.filter(o => o.event === eventName)}
          empty="這個場次還沒有收入"
        />
      )}

      <button onClick={load} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-stone-100 py-3 font-medium">
        <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> 重新計算
      </button>
    </div>
  );
}

// 有伺服器數字時：伺服器 + 本機未同步；沒有時只用本機全部的單據
function TotalsCard({ title, server, localOrders, empty }: { title: string; server: Totals | null; localOrders: OutboxOrder[]; empty: string }) {
  const localPending = localOrders.filter(o => o.status !== 'SYNCED');
  const byMethod = new Map(Object.entries(server?.byPaymentMethod ?? {}));
  (server ? localPending : localOrders).forEach(o => byMethod.set(o.paymentMethod, (byMethod.get(o.paymentMethod) ?? 0) + o.finalTotal));
  const total = [...byMethod.values()].reduce((a, b) => a + b, 0);

  return (
    <section className="overflow-hidden rounded-2xl bg-white">
      <div className="p-6 text-center">
        <p className="text-stone-500">{title}</p>
        <p className="mt-1 text-5xl font-bold">${total}</p>
        <p className="mt-2 text-sm text-stone-500">
          {server
            ? `所有裝置 ${server.orderCount} 筆，沖銷 ${server.revertCount} 筆${localPending.length ? `，含本機 ${localPending.length} 筆未同步` : ''}`
            : '離線中：僅本機資料'}
        </p>
      </div>
      <ul className="divide-y divide-stone-100 border-t border-stone-100">
        {[...byMethod.entries()].map(([method, amount]) => (
          <li key={method} className="flex justify-between px-5 py-3">
            <span>{method}</span>
            <span className="font-bold">${amount}</span>
          </li>
        ))}
        {byMethod.size === 0 && <li className="px-5 py-3 text-stone-500">{empty}</li>}
      </ul>
    </section>
  );
}
