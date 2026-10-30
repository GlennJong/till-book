import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const UPDATE_CHECK_MS = 60 * 60 * 1000;
const OFFLINE_READY_MS = 3000;

// PWA 更新提示：不自動重新整理（收銀中的購物車只在記憶體裡），由使用者按下更新
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker
  } = useRegisterSW({
    // 長時間開著的平板也能發現新版本
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => registration.update(), UPDATE_CHECK_MS);
    }
  });

  useEffect(() => {
    if (!offlineReady) return;
    const timer = setTimeout(() => setOfflineReady(false), OFFLINE_READY_MS);
    return () => clearTimeout(timer);
  }, [offlineReady, setOfflineReady]);

  if (needRefresh) {
    return (
      <div className="fixed inset-x-0 top-16 z-50 flex justify-center px-4">
        <div className="flex items-center gap-3 rounded-2xl bg-stone-900 px-4 py-3 text-sm text-white shadow-lg">
          <span>有新版本。請先結完手上這筆帳再更新。</span>
          <button onClick={() => updateServiceWorker(true)} className="rounded-lg bg-white px-3 py-1.5 font-bold text-stone-900">
            更新
          </button>
          <button onClick={() => setNeedRefresh(false)} className="text-stone-300">
            稍後
          </button>
        </div>
      </div>
    );
  }

  if (offlineReady) {
    return (
      <div className="fixed inset-x-0 top-16 z-50 flex justify-center px-4">
        <p className="rounded-full bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">已可離線使用</p>
      </div>
    );
  }

  return null;
}
