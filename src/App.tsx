import { useState } from 'react';
import AppShell from './screens/AppShell';
import SetupScreen from './screens/SetupScreen';
import { clearCatalog } from './lib/catalog';
import { clearConnection, loadConnection, saveConnection, type Connection } from './lib/connection';

export default function App() {
  const [connection, setConnection] = useState<Connection | null>(loadConnection);

  const connect = async (next: Connection) => {
    if (next.fileId !== connection?.fileId) await clearCatalog();
    saveConnection(next);
    setConnection(next);
  };

  // 設定頁會先確認沒有未同步的訂單才允許切換
  const disconnect = () => {
    clearConnection();
    setConnection(null);
  };

  if (connection) return <AppShell key={connection.fileId} connection={connection} onDisconnect={disconnect} />;

  return (
    <main className="min-h-dvh bg-stone-50 px-4 py-6 text-stone-900">
      <SetupScreen onConnected={connect} />
    </main>
  );
}
