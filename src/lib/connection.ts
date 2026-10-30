// 目前使用中的帳本（試算表），存在 localStorage 讓 App 啟動時能同步讀取

export interface Connection {
  fileId: string;
  name: string;
  scriptUrl: string;
}

const KEY = 'till_connection';

export const loadConnection = (): Connection | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Connection) : null;
  } catch {
    return null;
  }
};

export const saveConnection = (connection: Connection) => localStorage.setItem(KEY, JSON.stringify(connection));

export const clearConnection = () => localStorage.removeItem(KEY);
