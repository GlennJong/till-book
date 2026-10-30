import { useEffect } from 'react';

// 收銀畫面防休眠；切回前景時重新取得（瀏覽器在背景時會自動釋放）
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) sentinel.release();
      } catch {
        // 省電模式或不支援時忽略
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && request();

    request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release();
    };
  }, [enabled]);
}
