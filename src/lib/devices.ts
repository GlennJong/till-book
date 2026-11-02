// 裝置通行證（見 spec 8.4）：試算表的隱藏分頁 _裝置 記錄每台裝置的通行碼，GAS 依此放行請求
// 只有擁有者（用 Google 登入）能透過 Sheets API 新增、停用；副手只拿到自己的通行碼

export const DEVICES_TAB = '_裝置';
const HEADERS = ['通行碼', '名稱', '建立時間', '停用'];
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface Device {
  row: number; // 試算表列號（從 2 起），停用時用
  key: string;
  name: string;
  createdAt: string;
  disabled: boolean;
}

async function sheetsFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SHEETS_API}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `Google 試算表回應異常 (${res.status})`);
  }
  return res.json();
}

const range = (a1: string) => encodeURIComponent(`'${DEVICES_TAB}'!${a1}`);

// 32 個字元的隨機通行碼（base64url）
export function newDeviceKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

// 給擁有者自己的裝置一個好認的預設名稱
export function deviceLabel(userAgent = navigator.userAgent) {
  const kind = /iPad/.test(userAgent) ? 'iPad' : /iPhone/.test(userAgent) ? 'iPhone' : /Android/.test(userAgent) ? 'Android' : /Mac/.test(userAgent) ? 'Mac' : /Windows/.test(userAgent) ? 'Windows' : '裝置';
  return `擁有者・${kind}`;
}

// 舊帳本沒有 _裝置 分頁：新增一個隱藏分頁並寫入標題，停用欄做成勾選框
async function ensureDevicesTab(token: string, fileId: string) {
  const meta = await sheetsFetch<{ sheets: { properties: { title: string } }[] }>(token, `${fileId}?fields=sheets.properties.title`);
  if (meta.sheets.some(s => s.properties.title === DEVICES_TAB)) return;
  const added = await sheetsFetch<{ replies: { addSheet: { properties: { sheetId: number } } }[] }>(token, `${fileId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: DEVICES_TAB, hidden: true, gridProperties: { frozenRowCount: 1 } } } }] })
  });
  const sheetId = added.replies[0].addSheet.properties.sheetId;
  await sheetsFetch(token, `${fileId}/values/${range('A1:D1')}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [HEADERS] }) });
  await sheetsFetch(token, `${fileId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          setDataValidation: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 },
            rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true }
          }
        }
      ]
    })
  });
}

export async function listDevices(token: string, fileId: string): Promise<Device[]> {
  try {
    const data = await sheetsFetch<{ values?: unknown[][] }>(token, `${fileId}/values/${range('A2:D')}`);
    return (data.values ?? [])
      .map((v, i) => ({
        row: i + 2,
        key: String(v[0] ?? ''),
        name: String(v[1] ?? ''),
        createdAt: String(v[2] ?? ''),
        disabled: String(v[3] ?? '').toUpperCase() === 'TRUE'
      }))
      .filter(d => d.key);
  } catch (err) {
    // 還沒有 _裝置 分頁
    if (String(err).includes('Unable to parse range')) return [];
    throw err;
  }
}

export async function addDevice(token: string, fileId: string, name: string): Promise<string> {
  await ensureDevicesTab(token, fileId);
  const key = newDeviceKey();
  await sheetsFetch(token, `${fileId}/values/${range('A:D')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [[key, name.trim(), new Date().toLocaleString(), false]] })
  });
  return key;
}

export async function setDeviceDisabled(token: string, fileId: string, row: number, disabled: boolean) {
  await sheetsFetch(token, `${fileId}/values/${range(`D${row}`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[disabled]] })
  });
}

// 擁有者用 Google 登入連上帳本時：已經在用通行證的帳本，替這台裝置也發一張；還沒發過邀請的帳本維持不檢查
export async function ownerKeyIfNeeded(token: string, fileId: string) {
  const devices = await listDevices(token, fileId);
  return devices.length > 0 ? addDevice(token, fileId, deviceLabel()) : undefined;
}
