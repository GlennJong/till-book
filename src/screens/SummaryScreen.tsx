import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw } from 'lucide-react';
import { callScript } from '../lib/api';
import { db } from '../lib/db';

interface SummaryResponse {
  date: string;
  total: number;
  byPaymentMethod: Record<string, number>;
  orderCount: number;
  revertCount: number;
}

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const isToday = (iso: string) => {
  const d = new Date(iso);
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
};

// 今日收入：試算表的加總（所有裝置）＋本機還沒同步的單據
export default function SummaryScreen({ scriptUrl }: { scriptUrl: string }) {
  const [server, setServer] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  const todayOrders = useLiveQuery(() => db.outbox.toArray(), [])?.filter(o => isToday(o.createdAt)) ?? [];
  const localPending = todayOrders.filter(o => o.status !== 'SYNCED');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setServer(await callScript<SummaryResponse>(scriptUrl, 'summary', { params: { date: todayKey() } }));
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [scriptUrl]);

  useEffect(() => {
    load();
  }, [load]);

  // 離線時只能用本機全部的今日單據；上線時用伺服器數字 + 本機未同步
  const base = offline || !server ? todayOrders : localPending;
  const byMethod = new Map(Object.entries(offline || !server ? {} : server.byPaymentMethod));
  base.forEach(o => byMethod.set(o.paymentMethod, (byMethod.get(o.paymentMethod) ?? 0) + o.finalTotal));
  const total = [...byMethod.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div className="rounded-2xl bg-white p-6 text-center">
        <p className="text-stone-500">今日收入 {todayKey()}</p>
        <p className="mt-1 text-5xl font-bold">${total}</p>
        <p className="mt-2 text-sm text-stone-500">
          {offline || !server
            ? '離線中：僅本機資料'
            : `所有裝置 ${server.orderCount} 筆，沖銷 ${server.revertCount} 筆${localPending.length ? `，含本機 ${localPending.length} 筆未同步` : ''}`}
        </p>
      </div>

      <ul className="divide-y divide-stone-100 rounded-2xl bg-white">
        {[...byMethod.entries()].map(([method, amount]) => (
          <li key={method} className="flex justify-between px-5 py-3">
            <span>{method}</span>
            <span className="font-bold">${amount}</span>
          </li>
        ))}
        {byMethod.size === 0 && <li className="px-5 py-3 text-stone-500">今天還沒有收入</li>}
      </ul>

      <button onClick={load} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-stone-100 py-3 font-medium">
        <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> 重新計算
      </button>
    </div>
  );
}
