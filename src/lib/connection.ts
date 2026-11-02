// 目前使用中的帳本（試算表），存在 localStorage 讓 App 啟動時能同步讀取

export interface Connection {
  fileId: string;
  name: string;
  scriptUrl: string;
  key?: string; // 裝置通行證（見 spec 8.4）；還沒發過邀請的帳本沒有
  role?: 'owner' | 'guest'; // guest：透過邀請連結加入，沒有 Google 權限
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

// 呼叫 GAS 用的網址：帶上這台裝置的通行證
export const scriptEndpoint = (connection: Connection) => {
  if (!connection.key) return connection.scriptUrl;
  const url = new URL(connection.scriptUrl);
  url.searchParams.set('key', connection.key);
  return url.toString();
};

// 邀請連結：帳本資訊放在網址 # 後面，不會送到伺服器
const INVITE_PARAM = 'join';

const toBase64Url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (data: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

export function inviteLink(connection: Connection, key: string, appUrl = location.origin + location.pathname) {
  const payload = { f: connection.fileId, n: connection.name, u: connection.scriptUrl, k: key };
  return `${appUrl}#${INVITE_PARAM}=${toBase64Url(JSON.stringify(payload))}`;
}

export function parseInvite(hash: string): Connection | null {
  const data = new URLSearchParams(hash.replace(/^#/, '')).get(INVITE_PARAM);
  if (!data) return null;
  try {
    const { f, n, u, k } = JSON.parse(fromBase64Url(data));
    if (typeof f !== 'string' || typeof u !== 'string' || !u.startsWith('https://script.google.com/') || typeof k !== 'string') return null;
    return { fileId: f, name: String(n ?? ''), scriptUrl: u, key: k, role: 'guest' };
  } catch {
    return null;
  }
}
