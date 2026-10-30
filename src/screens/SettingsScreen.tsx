import { useState } from 'react';
import { AlertTriangle, ExternalLink, LogOut, Plus, RefreshCw, X } from 'lucide-react';
import { simulateNextFailure, type SimulatedFailure } from '../lib/api';
import type { Connection } from '../lib/connection';
import { updateSettings, useSettings, type Settings } from '../lib/settings';
import { useSync } from '../lib/sync';
import { useCatalog } from '../lib/useCatalog';

const REFRESH_MODES: { value: Settings['stockRefreshMode']; label: string; hint: string }[] = [
  { value: 'AFTER_SYNC', label: '結帳同步後', hint: '每次送出訂單順便更新庫存，不多花流量' },
  { value: 'INTERVAL', label: '定時', hint: '多台裝置一起收銀時，定時拉取其他裝置的銷售' },
  { value: 'MANUAL', label: '手動', hint: '只在按「同步商品資料」時更新' }
];

export default function SettingsScreen({ connection, onDisconnect }: { connection: Connection; onDisconnect: () => void }) {
  const settings = useSettings();
  const { refreshNow, refreshing } = useSync();
  const { warnings, syncedAt, pendingCount } = useCatalog();
  const [newMethod, setNewMethod] = useState('');

  const addMethod = () => {
    const name = newMethod.trim();
    if (!name || settings.paymentMethods.includes(name)) return;
    updateSettings({ paymentMethods: [...settings.paymentMethods, name] });
    setNewMethod('');
  };

  const disconnect = () => {
    if (pendingCount > 0) {
      window.alert(`還有 ${pendingCount} 筆訂單尚未同步到試算表，請連上網路同步完成後再切換帳本。`);
      return;
    }
    onDisconnect();
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-4">
      <section className="rounded-2xl bg-white p-5">
        <h2 className="font-bold">{connection.name}</h2>
        <p className="text-sm text-stone-500">{syncedAt ? `商品資料更新於 ${new Date(syncedAt).toLocaleString()}` : '尚未同步'}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={refreshNow} disabled={refreshing} className="inline-flex items-center gap-1 rounded-xl bg-stone-900 px-4 py-2 font-medium text-white">
            <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} /> 同步商品資料
          </button>
          <a
            href={`https://docs.google.com/spreadsheets/d/${connection.fileId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-xl bg-stone-100 px-4 py-2 font-medium"
          >
            打開試算表 <ExternalLink className="size-4" />
          </a>
        </div>
        {warnings.length > 0 && (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <p className="flex items-center gap-1 font-medium"><AlertTriangle className="size-4" /> 試算表有資料需要修正</p>
            <ul className="mt-1 list-disc pl-5">{warnings.map(w => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5">
        <h2 className="font-bold">付款方式</h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {settings.paymentMethods.map(m => (
            <li key={m} className="inline-flex items-center gap-1 rounded-full bg-stone-100 py-1 pr-1 pl-3">
              {m}
              <button
                onClick={() => updateSettings({ paymentMethods: settings.paymentMethods.filter(x => x !== m) })}
                disabled={settings.paymentMethods.length <= 1}
                className="rounded-full p-1 text-stone-500 disabled:opacity-30"
                aria-label={`移除 ${m}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <input
            value={newMethod}
            onChange={e => setNewMethod(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addMethod()}
            placeholder="例如：街口支付"
            className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-2"
          />
          <button onClick={addMethod} className="rounded-xl bg-stone-100 px-3" aria-label="新增付款方式">
            <Plus className="size-5" />
          </button>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5">
        <h2 className="font-bold">庫存更新方式</h2>
        <div className="mt-2 flex flex-col gap-2">
          {REFRESH_MODES.map(mode => (
            <label key={mode.value} className="flex gap-3 rounded-xl border border-stone-200 p-3">
              <input
                type="radio"
                name="refresh"
                checked={settings.stockRefreshMode === mode.value}
                onChange={() => updateSettings({ stockRefreshMode: mode.value })}
              />
              <span>
                <span className="font-medium">{mode.label}</span>
                <span className="block text-sm text-stone-500">{mode.hint}</span>
                {mode.value === 'INTERVAL' && settings.stockRefreshMode === 'INTERVAL' && (
                  <span className="mt-1 flex items-center gap-1 text-sm">
                    每
                    <input
                      type="number"
                      min={1}
                      value={settings.stockRefreshIntervalMin}
                      onChange={e => updateSettings({ stockRefreshIntervalMin: Math.max(1, Number(e.target.value) || 1) })}
                      className="w-16 rounded border border-stone-300 px-2 py-0.5"
                    />
                    分鐘
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </section>

      {import.meta.env.DEV && <FailureSimulator />}

      <button onClick={disconnect} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white py-3 font-medium text-stone-600">
        <LogOut className="size-4" /> 切換帳本
      </button>
    </div>
  );
}

// 開發模式專用：手動重現同步失敗，確認重送後試算表不會有重複資料
function FailureSimulator() {
  const [armed, setArmed] = useState<SimulatedFailure | null>(null);
  const arm = (failure: SimulatedFailure) => {
    simulateNextFailure(failure);
    setArmed(failure);
  };

  return (
    <section className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-5 text-sm">
      <h2 className="font-bold">模擬網路問題（僅開發模式）</h2>
      <p className="mt-1 text-amber-900">設定後，下一次送出訂單會失敗一次，之後自動重送（約 5–10 秒）。</p>
      <div className="mt-3 flex flex-col gap-2">
        <button onClick={() => arm('drop-response')} className="rounded-xl bg-white px-4 py-2 text-left font-medium">
          回應遺失：伺服器已寫入，App 沒收到結果
        </button>
        <button onClick={() => arm('offline')} className="rounded-xl bg-white px-4 py-2 text-left font-medium">
          送出失敗：請求沒送到伺服器
        </button>
      </div>
      {armed && (
        <p className="mt-3 text-amber-900">
          已設定「{armed === 'drop-response' ? '回應遺失' : '送出失敗'}」。到收銀頁結一筆帳 → 右上角會顯示「待同步」→ 等它自動變回「已同步」→
          打開試算表，確認銷售紀錄裡這張單號只出現一次。
        </p>
      )}
    </section>
  );
}
