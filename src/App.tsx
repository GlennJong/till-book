import { useEffect, useState } from 'react';
import UpdatePrompt from './components/UpdatePrompt';
import AppShell from './screens/AppShell';
import SetupScreen from './screens/SetupScreen';
import { clearCatalog } from './lib/catalog';
import { db } from './lib/db';
import { clearConnection, loadConnection, parseInvite, saveConnection, type Connection } from './lib/connection';

export default function App() {
  const [connection, setConnection] = useState<Connection | null>(loadConnection);

  const connect = async (next: Connection) => {
    if (next.fileId !== connection?.fileId) await clearCatalog();
    saveConnection(next);
    setConnection(next);
  };

  // 打開邀請連結：確認後加入帳本，並把通行證從網址列清掉
  useEffect(() => {
    const invite = parseInvite(location.hash);
    if (!invite) return;
    history.replaceState(null, '', location.pathname + location.search);
    if (invite.fileId === connection?.fileId && invite.key === connection.key) return;
    (async () => {
      const switching = !!connection && invite.fileId !== connection.fileId;
      // 未同步的單會送到新的帳本，所以換帳本前一定要先同步完
      if (switching && (await db.outbox.where('status').notEqual('SYNCED').count()) > 0) {
        window.alert(`目前的帳本「${connection.name}」還有訂單尚未同步，請連上網路同步完成後再打開邀請連結。`);
        return;
      }
      const note = switching ? `（會離開目前的帳本「${connection.name}」）` : '';
      if (window.confirm(`加入帳本「${invite.name}」，用這台裝置收銀？${note}`)) await connect(invite);
    })();
    // 只在開啟時處理一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 設定頁會先確認沒有未同步的訂單才允許切換
  const disconnect = () => {
    clearConnection();
    setConnection(null);
  };

  return (
    <>
      <UpdatePrompt />
      {connection ? (
        <AppShell key={connection.fileId} connection={connection} onConnectionChange={connect} onDisconnect={disconnect} />
      ) : (
        <main className="min-h-dvh bg-stone-50 px-4 py-6 text-stone-900">
          <SetupScreen onConnected={connect} />
        </main>
      )}
    </>
  );
}
