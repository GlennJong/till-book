import { useLiveQuery } from 'dexie-react-hooks';
import { getSetting, setSetting } from './db';

export interface Settings {
  paymentMethods: string[];
  stockRefreshMode: 'AFTER_SYNC' | 'INTERVAL' | 'MANUAL';
  stockRefreshIntervalMin: number;
}

export const DEFAULT_SETTINGS: Settings = {
  paymentMethods: ['現金', 'LINE Pay', '轉帳'],
  stockRefreshMode: 'AFTER_SYNC',
  stockRefreshIntervalMin: 10
};

const KEY = 'appSettings';

export function useSettings(): Settings {
  const stored = useLiveQuery(() => getSetting<Partial<Settings>>(KEY), []);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function updateSettings(patch: Partial<Settings>) {
  const current = (await getSetting<Partial<Settings>>(KEY)) ?? {};
  await setSetting(KEY, { ...current, ...patch });
}
