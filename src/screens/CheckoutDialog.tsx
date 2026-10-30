import { useMemo, useState } from 'react';
import Modal from '../components/Modal';
import { placeOrder } from '../lib/outbox';
import { priceCart, type CartItem, type PricingRules } from '../lib/pricing';
import { useSettings } from '../lib/settings';
import { useSync } from '../lib/sync';

const QUICK_CASH = [100, 500, 1000];

export default function CheckoutDialog(props: {
  cart: CartItem[];
  rules: PricingRules;
  onClose: () => void;
  onDone: (orderNo: string) => void;
}) {
  const { paymentMethods } = useSettings();
  const { syncNow } = useSync();
  const [paymentMethod, setPaymentMethod] = useState(paymentMethods[0] ?? '現金');
  const [manualTotal, setManualTotal] = useState('');
  const [received, setReceived] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const manual = manualTotal.trim() === '' ? undefined : Number(manualTotal);
  const manualValid = manual === undefined || (Number.isFinite(manual) && manual >= 0);
  const pricing = useMemo(
    () => priceCart(props.cart, props.rules, manualValid ? manual : undefined),
    [props.cart, props.rules, manual, manualValid]
  );
  const change = received === null ? null : received - pricing.total;

  const submit = async () => {
    setSubmitting(true);
    try {
      const order = await placeOrder({ lines: pricing.lines, paymentMethod, note });
      props.onDone(order.orderNo);
      syncNow();
    } catch (err) {
      window.alert(String(err));
      setSubmitting(false);
    }
  };

  return (
    <Modal title="結帳" onClose={props.onClose}>
      <div className="flex items-baseline justify-between">
        <span className="text-stone-600">應收</span>
        <span className="text-4xl font-bold">${pricing.total}</span>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-stone-600">
        整單改價
        <input
          type="number"
          inputMode="numeric"
          placeholder="例如 300"
          value={manualTotal}
          onChange={e => setManualTotal(e.target.value)}
          className={`w-28 rounded-lg border px-3 py-1.5 ${manualValid ? 'border-stone-300' : 'border-red-500'}`}
        />
      </label>

      <p className="mt-4 mb-2 text-sm font-medium text-stone-600">付款方式</p>
      <div className="grid grid-cols-3 gap-2">
        {paymentMethods.map(m => (
          <button
            key={m}
            onClick={() => setPaymentMethod(m)}
            className={`h-12 rounded-xl font-medium ${m === paymentMethod ? 'bg-stone-900 text-white' : 'bg-stone-100'}`}
          >
            {m}
          </button>
        ))}
      </div>

      <p className="mt-4 mb-2 text-sm font-medium text-stone-600">收款（算找零）</p>
      <div className="grid grid-cols-4 gap-2">
        <button onClick={() => setReceived(pricing.total)} className={`h-12 rounded-xl font-medium ${received === pricing.total ? 'bg-stone-900 text-white' : 'bg-stone-100'}`}>
          剛好
        </button>
        {QUICK_CASH.map(amount => (
          <button
            key={amount}
            onClick={() => setReceived(amount)}
            className={`h-12 rounded-xl font-medium ${received === amount ? 'bg-stone-900 text-white' : 'bg-stone-100'}`}
          >
            ${amount}
          </button>
        ))}
      </div>
      <input
        type="number"
        inputMode="numeric"
        placeholder="或輸入收到的金額"
        value={received ?? ''}
        onChange={e => setReceived(e.target.value === '' ? null : Number(e.target.value))}
        className="mt-2 w-full rounded-xl border border-stone-300 px-4 py-2"
      />
      {change !== null && (
        <p className={`mt-3 text-center text-4xl font-bold ${change < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
          {change < 0 ? `還差 $${-change}` : `找 $${change}`}
        </p>
      )}

      <input
        placeholder="備註（選填，例如預購寄送資訊）"
        value={note}
        onChange={e => setNote(e.target.value)}
        className="mt-4 w-full rounded-xl border border-stone-300 px-4 py-2"
      />

      <button
        onClick={submit}
        disabled={submitting || !manualValid || pricing.lines.length === 0}
        className="mt-5 h-14 w-full rounded-xl bg-stone-900 text-lg font-bold text-white disabled:opacity-40"
      >
        完成結帳（{paymentMethod}）
      </button>
    </Modal>
  );
}
