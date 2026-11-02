import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactHooks } from '@glennjong/vibe-sheets';
import { ArrowLeft, Copy, Loader2, Share2 } from 'lucide-react';
import { inviteLink, type Connection } from '../lib/connection';
import { addDevice, deviceLabel, listDevices, setDeviceDisabled, type Device } from '../lib/devices';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// 裝置與邀請（見 spec 8.4）：擁有者用 Google 登入後，發邀請給其他裝置、停用或恢復
// 邀請連結就是收銀權限，只能當面掃 QR 或私訊傳送
export default function DevicesScreen(props: { connection: Connection; onConnectionChange: (next: Connection) => Promise<void>; onBack: () => void }) {
  const { connection } = props;
  const { login, accessToken } = ReactHooks.useGoogleAuth({ clientId });
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<{ name: string; link: string } | null>(null);

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const reload = useCallback(() => run(async () => setDevices(await listDevices(accessToken!, connection.fileId))), [run, accessToken, connection.fileId]);

  useEffect(() => {
    if (accessToken) reload();
  }, [accessToken, reload]);

  const createInvite = () =>
    run(async () => {
      const token = accessToken!;
      // 發出第一張邀請後就開始檢查通行證，所以這台自己要先有一張
      if (!connection.key) {
        const key = await addDevice(token, connection.fileId, deviceLabel());
        await props.onConnectionChange({ ...connection, key });
      }
      const key = await addDevice(token, connection.fileId, name);
      setInvite({ name: name.trim(), link: inviteLink(connection, key) });
      setName('');
      setDevices(await listDevices(token, connection.fileId));
    });

  const toggle = (device: Device) => {
    if (!device.disabled && device.key === connection.key && !window.confirm('這是目前這台裝置，停用後這台就不能收銀了。確定嗎？')) return;
    run(async () => {
      await setDeviceDisabled(accessToken!, connection.fileId, device.row, !device.disabled);
      setDevices(await listDevices(accessToken!, connection.fileId));
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-4">
      <button onClick={props.onBack} className="inline-flex items-center gap-1 self-start text-stone-600">
        <ArrowLeft className="size-4" /> 返回設定
      </button>

      <section className="rounded-2xl bg-white p-5">
        <h2 className="font-bold">裝置與邀請</h2>
        <p className="mt-1 text-sm text-stone-500">
          被邀請的裝置不用登入 Google 就能收銀、沖銷、看結算，但碰不到試算表本身。銷售紀錄的「裝置」欄會寫上是哪一台結的帳。
        </p>
        {!accessToken && (
          <button onClick={login} className="mt-4 w-full rounded-xl bg-stone-900 py-3 font-medium text-white">
            使用 Google 登入以管理裝置
          </button>
        )}
      </section>

      {accessToken && (
        <>
          <section className="rounded-2xl bg-white p-5">
            <h2 className="font-bold">邀請其他裝置</h2>
            <div className="mt-3 flex gap-2">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="裝置名稱，例如：小明手機"
                className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-2"
              />
              <button onClick={createInvite} disabled={busy || !name.trim()} className="rounded-xl bg-stone-900 px-4 font-medium text-white disabled:opacity-40">
                產生邀請
              </button>
            </div>
            {invite && <InviteCard {...invite} />}
          </section>

          <section className="rounded-2xl bg-white p-5">
            <h2 className="flex items-center gap-2 font-bold">
              裝置 {busy && <Loader2 className="size-4 animate-spin text-stone-400" />}
            </h2>
            {devices && devices.length === 0 && <p className="mt-2 text-sm text-stone-500">還沒發過邀請，目前任何拿到網址的裝置都能收銀。</p>}
            <ul className="mt-2 divide-y divide-stone-100">
              {devices?.map(d => (
                <li key={d.row} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className={`truncate font-medium ${d.disabled ? 'text-stone-400 line-through' : ''}`}>
                      {d.name || '（未命名）'}
                      {d.key === connection.key && <span className="ml-1 text-xs text-emerald-700">這台</span>}
                    </p>
                    <p className="text-xs text-stone-500">{d.createdAt}</p>
                  </div>
                  <button onClick={() => toggle(d)} disabled={busy} className="rounded-lg bg-stone-100 px-3 py-1.5 text-sm font-medium disabled:opacity-40">
                    {d.disabled ? '恢復' : '停用'}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-stone-500">停用後最多 1 分鐘生效。也可以直接在試算表的「_裝置」分頁勾選「停用」。</p>
          </section>
        </>
      )}
    </div>
  );
}

function InviteCard({ name, link }: { name: string; link: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    import('bwip-js/browser').then(bwip => {
      if (canvasRef.current) bwip.toCanvas(canvasRef.current, { bcid: 'qrcode', text: link, scale: 4 });
    });
  }, [link]);

  const canShare = typeof navigator.share === 'function';

  return (
    <div className="mt-4 flex flex-col items-center gap-3 rounded-xl bg-stone-50 p-4">
      <p className="text-sm font-medium">用「{name}」的相機掃描，或用私訊傳送連結</p>
      <canvas ref={canvasRef} className="w-56 max-w-full" style={{ imageRendering: 'pixelated' }} />
      <div className="flex w-full gap-2">
        <button onClick={() => navigator.clipboard.writeText(link).then(() => window.alert('已複製邀請連結'))} className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-white py-2 font-medium">
          <Copy className="size-4" /> 複製連結
        </button>
        {canShare && (
          <button onClick={() => navigator.share({ url: link }).catch(() => {})} className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-white py-2 font-medium">
            <Share2 className="size-4" /> 分享
          </button>
        )}
      </div>
      <p className="text-xs text-stone-500">這個連結就等於收銀權限，請不要公開張貼。</p>
    </div>
  );
}
