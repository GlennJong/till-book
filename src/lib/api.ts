// 呼叫 Till 的 GAS 自訂路由
// POST 不設 Content-Type（瀏覽器以 text/plain 送出，不會觸發 CORS preflight）

export class ScriptError extends Error {
  needsAuthorization: boolean;
  code?: string;
  constructor(message: string, needsAuthorization = false, code?: string) {
    super(message);
    this.needsAuthorization = needsAuthorization;
    this.code = code;
  }
}

// 裝置通行證被拒（見 spec 8.4）：要給人看得懂的說明，App 會常駐顯示
const DEVICE_ERRORS: Record<string, string> = {
  DEVICE_REVOKED: '這台裝置的通行證已停用，請向帳本擁有者重新索取邀請',
  DEVICE_UNKNOWN: '這台裝置沒有通行證：擁有者請到「設定 → 切換帳本」重新選擇這本帳本；其他人請向擁有者索取邀請'
};
export const isDeviceError = (err: ScriptError | null) => !!err?.code && err.code in DEVICE_ERRORS;

// 開發模式專用：讓下一次送出訂單失敗，用來手動驗證重送不會造成重複（見設定頁「模擬網路問題」）
// offline：請求沒送出；drop-response：伺服器已寫入，但回應在半路遺失
export type SimulatedFailure = 'offline' | 'drop-response';
let simulatedFailure: SimulatedFailure | null = null;
export const simulateNextFailure = (failure: SimulatedFailure | null) => {
  simulatedFailure = import.meta.env.DEV ? failure : null;
};

export async function callScript<T>(
  scriptUrl: string,
  action: string,
  options: { body?: unknown; params?: Record<string, string> } = {}
): Promise<T> {
  const url = new URL(scriptUrl);
  url.searchParams.set('action', action);
  Object.entries(options.params || {}).forEach(([key, value]) => url.searchParams.set(key, value));
  if (options.body === undefined) url.searchParams.set('t', String(Date.now()));

  const simulate = options.body !== undefined ? simulatedFailure : null;
  if (simulate) simulatedFailure = null;
  if (simulate === 'offline') throw new ScriptError('（模擬）目前離線');

  let res: Response;
  try {
    res = await fetch(url.toString(), options.body === undefined
      ? { method: 'GET' }
      : { method: 'POST', body: JSON.stringify(options.body) });
  } catch {
    // 未授權時 Google 會回傳沒有 CORS 標頭的登入頁，瀏覽器只會看到 Failed to fetch
    throw new ScriptError(navigator.onLine ? '無法連線到試算表腳本，可能尚未授權' : '目前離線', navigator.onLine);
  }

  const text = await res.text();
  if (simulate === 'drop-response') throw new ScriptError('（模擬）伺服器已寫入，但回應遺失');
  if (!res.ok || text.trim().startsWith('<')) {
    throw new ScriptError(`試算表腳本回應異常 (${res.status})`, true);
  }

  const data = JSON.parse(text);
  if (data && typeof data === 'object' && 'error' in data) {
    if (DEVICE_ERRORS[data.error]) throw new ScriptError(DEVICE_ERRORS[data.error], false, data.error);
    throw new ScriptError(`試算表腳本錯誤：${data.error}`);
  }
  return data as T;
}
