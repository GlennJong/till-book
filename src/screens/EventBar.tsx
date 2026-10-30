import { useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import Modal from '../components/Modal';
import { clearEvent, startEvent, toDateKey, useCurrentEvent, useRecentEvents, type CurrentEvent } from '../lib/event';

// 收銀畫面上方的場次列：顯示目前場次、點擊設定；場次過期時提示開始新場次
export default function EventBar() {
  const { active, expired } = useCurrentEvent();
  const [editing, setEditing] = useState(false);

  return (
    <>
      {expired ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="min-w-0 flex-1">場次「{expired.name}」已結束，新的訂單不會再記到這個場次。</span>
          <button onClick={() => setEditing(true)} className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white">
            開始新場次
          </button>
          <button onClick={() => clearEvent()} className="rounded-lg bg-white px-3 py-1.5 font-medium">
            不指定
          </button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          aria-label="設定場次"
          className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm"
        >
          <CalendarDays className="size-4 shrink-0 text-stone-500" />
          {active ? (
            <span className="truncate">
              <span className="hidden sm:inline">目前場次：</span>
              <span className="font-bold">{active.name}</span>
            </span>
          ) : (
            <span className="text-stone-500">未指定場次</span>
          )}
          <ChevronDown className="size-4 shrink-0 text-stone-400" />
        </button>
      )}

      {editing && <EventDialog current={active} onClose={() => setEditing(false)} />}
    </>
  );
}

function EventDialog({ current, onClose }: { current: CurrentEvent | null; onClose: () => void }) {
  const recentEvents = useRecentEvents();
  const today = toDateKey(new Date());
  const [name, setName] = useState(current?.name ?? '');
  const [endDate, setEndDate] = useState(current ? toDateKey(new Date(current.endsAt)) : today);
  const valid = name.trim() !== '' && endDate >= today;

  const save = async () => {
    await startEvent(name, endDate);
    onClose();
  };

  return (
    <Modal title="場次" onClose={onClose}>
      <p className="text-sm text-stone-500">之後的訂單都會記上這個場次，試算表的「銷量統計」可以依場次查看。過了結束日期會自動取消。</p>

      <label className="mt-4 block text-sm font-medium text-stone-600">
        場次名稱
        <input
          autoFocus
          list="recent-events"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="例如 CWT70"
          className="mt-1 w-full rounded-xl border border-stone-300 px-4 py-3 text-lg"
        />
      </label>
      <datalist id="recent-events">
        {recentEvents.map(e => (
          <option key={e} value={e} />
        ))}
      </datalist>
      {recentEvents.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {recentEvents.slice(0, 5).map(e => (
            <button key={e} onClick={() => setName(e)} className="rounded-full bg-stone-100 px-3 py-1 text-sm">
              {e}
            </button>
          ))}
        </div>
      )}

      <label className="mt-4 block text-sm font-medium text-stone-600">
        結束日期（跨天的場次選最後一天）
        <input
          type="date"
          min={today}
          value={endDate}
          onChange={e => setEndDate(e.target.value)}
          className="mt-1 w-full rounded-xl border border-stone-300 px-4 py-3"
        />
      </label>

      <div className="mt-5 flex gap-2">
        {current && (
          <button
            onClick={async () => {
              await clearEvent();
              onClose();
            }}
            className="h-12 flex-1 rounded-xl bg-stone-100 font-medium"
          >
            不指定場次
          </button>
        )}
        <button onClick={save} disabled={!valid} className="h-12 flex-1 rounded-xl bg-stone-900 font-bold text-white disabled:opacity-40">
          確定
        </button>
      </div>
    </Modal>
  );
}
