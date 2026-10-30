import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ScriptError } from './api';
import { refreshCatalog } from './catalog';
import { db } from './db';
import { healOutbox, syncOutbox, type SyncResult } from './outbox';
import { useSettings } from './settings';

// 同步引擎：啟動自我修復、結帳後與定時送出 outbox、上線時重送、依設定刷新庫存

const RETRY_CHECK_MS = 5000;

let healedThisPageLoad = false;

interface SyncState {
  syncing: boolean;
  refreshing: boolean;
  error: ScriptError | null;
  rejected: SyncResult['rejected'];
  syncNow: () => Promise<void>;
  refreshNow: () => Promise<void>;
}

const SyncContext = createContext<SyncState | null>(null);

export const useSync = () => {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
};

const toScriptError = (err: unknown) => (err instanceof ScriptError ? err : new ScriptError(String(err)));

export function SyncProvider({ scriptUrl, children }: { scriptUrl: string; children: React.ReactNode }) {
  const settings = useSettings();
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ScriptError | null>(null);
  const [rejected, setRejected] = useState<SyncResult['rejected']>([]);

  const applyStockRef = useRef(settings.stockRefreshMode === 'AFTER_SYNC');
  applyStockRef.current = settings.stockRefreshMode === 'AFTER_SYNC';

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await syncOutbox(scriptUrl, { applyStock: applyStockRef.current });
      if (res.sent > 0) setError(null);
      if (res.rejected.length > 0) setRejected(prev => [...prev, ...res.rejected]);
    } catch (err) {
      setError(toScriptError(err));
    } finally {
      setSyncing(false);
    }
  }, [scriptUrl]);

  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshCatalog(scriptUrl);
      setError(null);
    } catch (err) {
      setError(toScriptError(err));
    } finally {
      setRefreshing(false);
    }
  }, [scriptUrl]);

  // 啟動：修復上次中斷的同步 → 拉取商品資料 → 送出待同步單據
  // 修復只在頁面載入時做一次，避免把本頁正在送出的單據退回 PENDING
  useEffect(() => {
    (async () => {
      if (!healedThisPageLoad) {
        healedThisPageLoad = true;
        await healOutbox();
      }
      await refreshNow();
      await syncNow();
    })();
  }, [refreshNow, syncNow]);

  // 重新上線：取消退避，立即重送
  useEffect(() => {
    const onOnline = async () => {
      await db.outbox.where('status').equals('PENDING').modify({ nextRetryAt: 0 });
      syncNow();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncNow]);

  // 定時檢查退避到期的單據（syncOutbox 只會送 nextRetryAt 已到的單據）
  useEffect(() => {
    const timer = setInterval(async () => {
      if ((await db.outbox.where('status').equals('PENDING').count()) > 0) syncNow();
    }, RETRY_CHECK_MS);
    return () => clearInterval(timer);
  }, [syncNow]);

  // 庫存刷新模式：定時
  useEffect(() => {
    if (settings.stockRefreshMode !== 'INTERVAL') return;
    const timer = setInterval(refreshNow, settings.stockRefreshIntervalMin * 60 * 1000);
    return () => clearInterval(timer);
  }, [settings.stockRefreshMode, settings.stockRefreshIntervalMin, refreshNow]);

  return (
    <SyncContext.Provider value={{ syncing, refreshing, error, rejected, syncNow, refreshNow }}>
      {children}
    </SyncContext.Provider>
  );
}
