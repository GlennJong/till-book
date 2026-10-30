import { useEffect, useState } from 'react';
import { ReactHooks, getAuthorizeUrl, type DriveFile } from '@glennjong/vibe-sheets';
import { ExternalLink, FileSpreadsheet, Loader2, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { SHEET_PREFIX, SCRIPT_VERSION, TILL_SCRIPT, TILL_TABS, tillSetupRequests } from '../backend/schema';
import type { Connection } from '../lib/connection';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const openAuthPopup = (scriptUrl: string) =>
  window.open(getAuthorizeUrl(scriptUrl), 'till-auth', 'width=600,height=640');

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="mx-auto w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">{children}</div>
);

const Spinner = () => <Loader2 className="size-5 animate-spin" />;

export default function SetupScreen({ onConnected }: { onConnected: (connection: Connection) => void }) {
  const { login, accessToken, isAppsScriptEnabled } = ReactHooks.useGoogleAuth({ clientId });

  if (!accessToken) {
    return (
      <Card>
        <h1 className="text-2xl font-bold">Till</h1>
        <p className="mt-2 text-stone-600">市集收銀，資料存在你自己的 Google 試算表。</p>
        <button onClick={login} className="mt-6 w-full rounded-xl bg-stone-900 py-3 font-medium text-white">
          使用 Google 登入
        </button>
      </Card>
    );
  }

  if (!isAppsScriptEnabled) {
    return (
      <Card>
        {isAppsScriptEnabled === undefined ? (
          <p className="flex items-center gap-2 text-stone-600"><Spinner /> 檢查 Apps Script 權限中…</p>
        ) : (
          <>
            <p>開始前需要先開啟 Google Apps Script API。</p>
            <a
              target="_blank"
              rel="noreferrer"
              href="https://script.google.com/home/usersettings"
              className="mt-4 inline-flex items-center gap-1 font-medium text-blue-700 underline"
            >
              前往設定 <ExternalLink className="size-4" />
            </a>
          </>
        )}
      </Card>
    );
  }

  return <SheetPicker token={accessToken} onConnected={onConnected} />;
}

function SheetPicker({ token, onConnected }: { token: string; onConnected: (connection: Connection) => void }) {
  const { files, fetchFiles, createSheet, creationResult, creationStatus, upgradeScript, loading, error } =
    ReactHooks.useSheetManager(token);
  const [sheetName, setSheetName] = useState('');
  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    fetchFiles(SHEET_PREFIX).finally(() => setInitialLoad(false));
  }, []);

  const handleCreate = async () => {
    if (!sheetName.trim()) return;
    await createSheet({
      sheetName: sheetName.trim(),
      prefix: SHEET_PREFIX,
      tabs: TILL_TABS,
      script: TILL_SCRIPT,
      setupRequests: tillSetupRequests
    });
    await fetchFiles(SHEET_PREFIX);
  };

  const handleUpgrade = async (file: DriveFile) => {
    await upgradeScript(file, TILL_SCRIPT);
    await fetchFiles(SHEET_PREFIX);
  };

  const connect = (file: DriveFile) =>
    file.scriptUrl && onConnected({ fileId: file.id, name: file.name.replace(SHEET_PREFIX, ''), scriptUrl: file.scriptUrl });

  // 剛建立完成：一定要先授權，否則匿名呼叫會被 Google 拒絕
  if (creationResult?.scriptUrl && creationResult.spreadsheetId) {
    const { scriptUrl, spreadsheetId, spreadsheetUrl } = creationResult;
    return (
      <Card>
        <h2 className="text-xl font-bold">帳本建立完成</h2>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-stone-700">
          <li>
            <button onClick={() => openAuthPopup(scriptUrl)} className="inline-flex items-center gap-1 font-medium text-blue-700 underline">
              <ShieldCheck className="size-4" /> 授權試算表腳本
            </button>
            <p className="text-sm text-stone-500">看到「Authorization successful」後關閉視窗即可。</p>
          </li>
          <li>
            <a href={spreadsheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline">
              打開試算表 <ExternalLink className="size-4" />
            </a>
            <p className="text-sm text-stone-500">裡面有範例商品，可以直接修改或刪除。</p>
          </li>
        </ol>
        <button
          onClick={() => onConnected({ fileId: spreadsheetId, name: sheetName.trim(), scriptUrl })}
          className="mt-6 w-full rounded-xl bg-stone-900 py-3 font-medium text-white"
        >
          授權完成，開始使用
        </button>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <Card>
        <h2 className="text-lg font-bold">建立新帳本</h2>
        <div className="mt-3 flex gap-2">
          <input
            value={sheetName}
            onChange={e => setSheetName(e.target.value)}
            placeholder="例如：2026 秋季場"
            disabled={loading}
            className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-2"
          />
          <button
            onClick={handleCreate}
            disabled={loading || !sheetName.trim()}
            className="inline-flex items-center gap-1 rounded-xl bg-stone-900 px-4 py-2 font-medium text-white disabled:opacity-40"
          >
            {creationStatus !== 'idle' && creationStatus !== 'completed' ? <Spinner /> : <Plus className="size-4" />}
            建立
          </button>
        </div>
        {creationStatus !== 'idle' && creationStatus !== 'completed' && (
          <p className="mt-3 text-sm text-stone-500">建立中（{creationStatus}），大約需要半分鐘…</p>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">我的帳本</h2>
          <button onClick={() => fetchFiles(SHEET_PREFIX)} disabled={loading} className="text-stone-500" aria-label="重新整理">
            <RefreshCw className={`size-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {initialLoad ? (
          <p className="mt-4 flex items-center gap-2 text-stone-500"><Spinner /> 讀取中…</p>
        ) : files.length === 0 ? (
          <p className="mt-4 text-stone-500">還沒有帳本，先在上方建立一本。</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100">
            {files.map(file => {
              const outdated = file.scriptVersion !== SCRIPT_VERSION;
              return (
                <li key={file.id} className="flex items-center gap-3 py-3">
                  <FileSpreadsheet className="size-5 shrink-0 text-green-700" />
                  <span className="min-w-0 flex-1 truncate">{file.name.replace(SHEET_PREFIX, '')}</span>
                  {file.isError ? (
                    <span className="text-sm text-red-600">設定損毀</span>
                  ) : outdated ? (
                    <button onClick={() => handleUpgrade(file)} disabled={loading} className="text-sm font-medium text-amber-700 underline">
                      升級腳本
                    </button>
                  ) : (
                    <button onClick={() => connect(file)} className="rounded-lg bg-stone-100 px-3 py-1.5 text-sm font-medium">
                      使用
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
