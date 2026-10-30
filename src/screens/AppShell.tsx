import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { SCRIPT_VERSION } from '../backend/schema';
import { getSetting } from '../lib/db';
import { getAuthorizeUrl } from '@glennjong/vibe-sheets';
import { BarChart3, Cloud, CloudOff, Receipt, Settings as SettingsIcon, ShoppingCart } from 'lucide-react';
import type { Connection } from '../lib/connection';
import { SyncProvider, useSync } from '../lib/sync';
import { useCatalog } from '../lib/useCatalog';
import OrdersScreen from './OrdersScreen';
import RegisterScreen from './RegisterScreen';
import SettingsScreen from './SettingsScreen';
import SummaryScreen from './SummaryScreen';

type Tab = 'register' | 'orders' | 'summary' | 'settings';

const TABS: { id: Tab; label: string; icon: typeof ShoppingCart }[] = [
  { id: 'register', label: '收銀', icon: ShoppingCart },
  { id: 'orders', label: '訂單', icon: Receipt },
  { id: 'summary', label: '結算', icon: BarChart3 },
  { id: 'settings', label: '設定', icon: SettingsIcon }
];

export default function AppShell({ connection, onDisconnect }: { connection: Connection; onDisconnect: () => void }) {
  return (
    <SyncProvider scriptUrl={connection.scriptUrl}>
      <Shell connection={connection} onDisconnect={onDisconnect} />
    </SyncProvider>
  );
}

function Shell({ connection, onDisconnect }: { connection: Connection; onDisconnect: () => void }) {
  const [tab, setTab] = useState<Tab>('register');
  const [toast, setToast] = useState<string | null>(null);
  const { pendingCount } = useCatalog();
  const { syncing, error, rejected } = useSync();
  // undefined：還沒同步過；null：腳本早於 1.2.0，不會回報版本
  const scriptVersion = useLiveQuery(() => getSetting<string | null>('scriptVersion'), []);
  const outdated = scriptVersion !== undefined && scriptVersion !== SCRIPT_VERSION;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const last = rejected[rejected.length - 1];
    if (last) setToast(last.status === 'already_reverted' ? `${last.orderNo}：原單已在其他裝置沖銷過` : `${last.orderNo}：資料格式錯誤，未寫入`);
  }, [rejected]);

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{connection.name}</h1>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm ${pendingCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}
          title={error?.message}
        >
          {pendingCount > 0 ? <CloudOff className="size-4" /> : <Cloud className={`size-4 ${syncing ? 'animate-pulse' : ''}`} />}
          {pendingCount > 0 ? `${pendingCount} 筆待同步` : '已同步'}
        </span>
      </header>

      {error?.needsAuthorization && (
        <div className="mx-4 mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error.message}。
          <a href={getAuthorizeUrl(connection.scriptUrl)} target="_blank" rel="noreferrer" className="font-medium underline">
            開啟授權頁面
          </a>
        </div>
      )}

      {outdated && (
        <div className="mx-4 mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          這本帳本的試算表腳本是舊版（{scriptVersion ?? '1.2.0 以前'}，最新 {SCRIPT_VERSION}）。請到「設定 → 切換帳本」，在帳本旁按「升級腳本」。
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col px-4 pb-20">
        {tab === 'register' && <RegisterScreen onCheckedOut={orderNo => setToast(`已結帳 ${orderNo}`)} onNotice={setToast} />}
        {tab === 'orders' && <OrdersScreen />}
        {tab === 'summary' && <SummaryScreen scriptUrl={connection.scriptUrl} />}
        {tab === 'settings' && <SettingsScreen connection={connection} onDisconnect={onDisconnect} />}
      </main>

      {toast && (
        <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <p className="rounded-full bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</p>
        </div>
      )}

      <nav aria-label="主選單" className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-4 border-t border-stone-200 bg-white">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} className={`flex flex-col items-center justify-center gap-0.5 text-xs ${tab === id ? 'text-stone-900' : 'text-stone-400'}`}>
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
