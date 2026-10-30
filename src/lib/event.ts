import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, setSetting } from './db';

// 場次：這台裝置目前的場次名稱 + 結束時間，過了結束時間自動失效（見 spec 4.3）
// 場次只是寫在銷售紀錄上的文字標籤，試算表沒有場次表

export interface CurrentEvent {
  name: string;
  endsAt: string; // ISO 8601
}

export const CURRENT_EVENT_KEY = 'currentEvent';

const EXPIRY_CHECK_MS = 30 * 1000;

const isActive = (event: CurrentEvent | undefined, now: Date): event is CurrentEvent =>
  !!event && new Date(event.endsAt).getTime() > now.getTime();

export const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// 結束日期（YYYY-MM-DD）當天的 23:59:59，以裝置時區計算
const endOfDay = (dateKey: string) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
};

export async function startEvent(name: string, endDate: string) {
  const event: CurrentEvent = { name: name.trim(), endsAt: endOfDay(endDate).toISOString() };
  if (!event.name) throw new Error('請輸入場次名稱');
  await setSetting(CURRENT_EVENT_KEY, event);
  return event;
}

export const clearEvent = () => db.settings.delete(CURRENT_EVENT_KEY);

export async function getActiveEventName(now = new Date()) {
  const event = await getSetting<CurrentEvent>(CURRENT_EVENT_KEY);
  return isActive(event, now) ? event.name : '';
}

// active：進行中的場次；expired：已過結束時間、還沒被換掉的場次（用來提示開始新場次）
export function useCurrentEvent() {
  const stored = useLiveQuery(() => getSetting<CurrentEvent>(CURRENT_EVENT_KEY), []);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), EXPIRY_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  const active = isActive(stored, now) ? stored : null;
  return { active, expired: stored && !active ? stored : null };
}

export const useRecentEvents = () => useLiveQuery(() => getSetting<string[]>('recentEvents'), []) ?? [];
