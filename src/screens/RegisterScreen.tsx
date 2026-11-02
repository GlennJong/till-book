import { useEffect, useMemo, useState } from 'react';
import { Camera, Gift, Hash, Minus, Pause, Plus, ShoppingCart, Trash2, Undo2 } from 'lucide-react';
import BundleHints from '../components/BundleHints';
import Modal from '../components/Modal';
import NumericKeypad from '../components/NumericKeypad';
import ProductImage from '../components/ProductImage';
import { activeCart, MAX_CARTS, reservedElsewhere, type CartAction, type CartColor, type CartState, type CartStateAction, type RegisterState } from '../lib/cart';
import { beep } from '../lib/feedback';
import { priceCart } from '../lib/pricing';
import { useBarcodeScanner } from '../lib/scanner';
import { useCatalog } from '../lib/useCatalog';
import { useRegister } from '../lib/useRegister';
import { useWakeLock } from '../lib/useWakeLock';
import CameraScanner from './CameraScanner';
import CheckoutDialog from './CheckoutDialog';
import EventBar from './EventBar';

const FLASH_MS = 400;
// 剩這麼多件以下就用橘色提醒快賣完
const LOW_STOCK = 3;

// 掛單的顏色（class 要寫完整，Tailwind 才掃得到）
const CART_STYLES: Record<CartColor, { name: string; dot: string; ring: string }> = {
  sky: { name: '藍', dot: 'bg-sky-500', ring: 'ring-sky-500' },
  amber: { name: '黃', dot: 'bg-amber-400', ring: 'ring-amber-400' },
  rose: { name: '紅', dot: 'bg-rose-500', ring: 'ring-rose-500' },
  violet: { name: '紫', dot: 'bg-violet-500', ring: 'ring-violet-500' },
  lime: { name: '綠', dot: 'bg-lime-500', ring: 'ring-lime-500' }
};

// 復原按鈕上顯示的「上一步」
const describeAction = (action: CartAction, products: { id: string; name: string }[]) => {
  const nameOf = (id: string) => products.find(p => p.id === id)?.name ?? '';
  if (action.type === 'clear') return '清空購物車';
  if (action.type === 'addMany') return '加入 ' + [...new Set(action.productIds)].map(nameOf).join('、');
  const name = nameOf(action.productId);
  return { add: '加入', decrement: '減少', remove: '移除', setManualPrice: '改價' }[action.type] + ' ' + name;
};

const ALL = '全部';

export default function RegisterScreen({ onCheckedOut, onNotice }: { onCheckedOut: (orderNo: string) => void; onNotice: (message: string) => void }) {
  const { products, rules, stock, onSite, categories } = useCatalog();
  const [register, dispatchRegister] = useRegister();
  const cartState = activeCart(register);
  const dispatch = (action: CartStateAction) => dispatchRegister({ type: 'cart', action });
  const cart = cartState.items;
  const canPark = cart.length > 0 && register.carts.length < MAX_CARTS;
  const park = () => {
    dispatchRegister({ type: 'park' });
    setCheckingOut(false);
  };
  // 手機底部列：依序切到下一張單
  const switchToNext = () => {
    const index = register.carts.findIndex(c => c.color === register.active);
    dispatchRegister({ type: 'switch', color: register.carts[(index + 1) % register.carts.length].color });
  };
  const lastAction = cartState.history.at(-1)?.action;
  const undoLabel = lastAction ? describeAction(lastAction, products) : null;
  const undo = () => dispatch({ type: 'undo' });
  // 選多個分類時取交集；空陣列代表「全部」
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const toggleCategory = (c: string) =>
    setSelectedCategories(prev => (prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]));
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [enteringCode, setEnteringCode] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  useWakeLock(true);

  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashId]);

  const pricing = useMemo(() => priceCart(cart, rules), [cart, rules]);
  const inCart = (id: string) => cart.find(i => i.productId === id)?.quantity ?? 0;
  // 有填現場數量的商品看現場剩餘，否則看總庫存；null 代表不追蹤。掛起的單也算已被拿走
  const remaining = (id: string) => {
    const site = onSite.get(id);
    const tracked = site ?? stock.get(id) ?? null;
    const left = tracked === null ? null : tracked - inCart(id) - reservedElsewhere(register, id);
    return { left, isOnSite: site !== null && site !== undefined };
  };

  const addProduct = (id: string) => {
    const { left, isOnSite } = remaining(id);
    if (left !== null && left <= 0) {
      const name = products.find(p => p.id === id)?.name;
      if (!window.confirm(`「${name}」${isOnSite ? '現場數量' : '庫存'}不足，仍要賣出嗎？（例如預購、展後寄送）`)) return;
    }
    dispatch({ type: 'add', productId: id });
  };

  // 湊組合提示：一次補齊組合其餘商品（復原算一步）；有賣完的先確認一次
  const addProducts = (ids: string[]) => {
    const short = [...new Set(ids)].filter(id => {
      const { left } = remaining(id);
      return left !== null && left < ids.filter(x => x === id).length;
    });
    if (short.length > 0) {
      const names = short.map(id => products.find(p => p.id === id)?.name).join('、');
      if (!window.confirm(`「${names}」數量不足，仍要加入嗎？（例如預購、展後寄送）`)) return;
    }
    dispatch({ type: 'addMany', productIds: ids });
  };

  // 任選組合的提示：切到該分類，關掉購物車與結帳視窗，方便挑剩下的款式
  const pickCategory = (category: string) => {
    setSelectedCategories([category]);
    setCartOpen(false);
    setCheckingOut(false);
  };

  // 掃碼槍、相機、手動輸入代碼共用：找到就加一件並嗶一聲，找不到播錯誤音並提示
  const addByCode = (raw: string) => {
    const code = raw.trim().toUpperCase();
    const product = code ? products.find(p => p.code.toUpperCase() === code) : undefined;
    if (!product) {
      beep('error');
      onNotice(`找不到商品代碼 ${raw.trim()}`);
      return;
    }
    beep('ok');
    setFlashId(product.id);
    addProduct(product.id);
  };
  useBarcodeScanner(addByCode);

  const visible = products.filter(p => selectedCategories.every(c => p.categories.includes(c)));
  const itemCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  const cartPanel = (
    <CartPanel
      register={register}
      canPark={canPark}
      onPark={park}
      onSwitch={color => dispatchRegister({ type: 'switch', color })}
      cart={cart}
      undoLabel={undoLabel}
      onUndo={undo}
      onAddProducts={addProducts}
      onPickCategory={pickCategory}
      pricing={pricing}
      products={products}
      onIncrement={id => addProduct(id)}
      onDecrement={id => dispatch({ type: 'decrement', productId: id })}
      onEditPrice={setEditingPrice}
      onClear={() => dispatch({ type: 'clear' })}
      onCheckout={() => setCheckingOut(true)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 場次與掃碼按鈕同一列：窄螢幕時場次名稱截斷、按鈕只留圖示 */}
        <div className="mb-3 flex items-center gap-2">
          <EventBar />
          <div className="ml-auto flex shrink-0 gap-2">
            <button onClick={() => setEnteringCode(true)} aria-label="輸入代碼" className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-sm">
              <Hash className="size-4 text-stone-500" /> <span className="hidden sm:inline">輸入代碼</span>
            </button>
            <button onClick={() => setCameraOpen(true)} aria-label="相機掃碼" className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-sm">
              <Camera className="size-4 text-stone-500" /> <span className="hidden sm:inline">相機掃碼</span>
            </button>
          </div>
        </div>
        <nav aria-label="商品分類" className="-mx-4 flex gap-2 overflow-x-auto pr-4 pb-3">
          {/* 「全部」固定在最左邊：分類很多、捲到右邊時也能一鍵清除篩選 */}
          <div className="sticky left-0 z-10 shrink-0 bg-stone-50 pr-1 pl-4 shadow-[8px_0_8px_-6px_rgba(0,0,0,0.15)]">
            <button
              onClick={() => setSelectedCategories([])}
              aria-pressed={selectedCategories.length === 0}
              className={`rounded-full px-4 py-2 text-sm font-medium ${selectedCategories.length === 0 ? 'bg-stone-900 text-white' : 'bg-white text-stone-700'}`}
            >
              {ALL}
            </button>
          </div>
          {categories.map(c => (
            <button
              key={c}
              onClick={() => toggleCategory(c)}
              aria-pressed={selectedCategories.includes(c)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${selectedCategories.includes(c) ? 'bg-stone-900 text-white' : 'bg-white text-stone-700'}`}
            >
              {c}
            </button>
          ))}
        </nav>

        {products.length === 0 ? (
          <p className="mt-10 text-center text-stone-500">還沒有商品。請在試算表的「商品」分頁新增後按同步。</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 pb-28 lg:pb-4">
            {visible.map(p => {
              const { left, isOnSite } = remaining(p.id);
              const soldOut = left !== null && left <= 0;
              const count = inCart(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => addProduct(p.id)}
                  className={`relative flex min-h-16 flex-col overflow-hidden rounded-xl border bg-white text-left transition-shadow active:scale-[0.98] ${count > 0 ? 'border-stone-900' : 'border-stone-200'} ${flashId === p.id ? 'ring-4 ring-emerald-400' : ''}`}
                >
                  <ProductImage productId={p.id} name={p.name} imageUrl={p.imageUrl} className={`aspect-square w-full ${soldOut ? 'opacity-40 grayscale' : ''}`} />
                  <div className="p-2">
                    <p className="line-clamp-2 text-sm leading-tight font-medium">{p.name}</p>
                    <p className="mt-1 flex items-baseline justify-between">
                      <span className="font-bold">${p.price}</span>
                      {left !== null && (
                        <span className={`text-xs ${soldOut ? 'text-red-600' : left <= LOW_STOCK ? 'font-bold text-amber-600' : 'text-stone-500'}`}>
                          {isOnSite ? '現場' : '剩'} {left}
                        </span>
                      )}
                    </p>
                  </div>
                  {soldOut && (
                    <span className="absolute top-2 left-2 rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">SOLD OUT</span>
                  )}
                  {count > 0 && (
                    <span className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-stone-900 text-sm font-bold text-white">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 寬螢幕：右側固定購物車 */}
      <aside className="hidden w-80 shrink-0 lg:block">{cartPanel}</aside>

      {/* 手機：底部購物車列，點開為抽屜 */}
      <div className="fixed inset-x-0 bottom-16 z-30 flex gap-2 px-4 pb-2 lg:hidden">
        {undoLabel && (
          <button onClick={undo} aria-label={`復原（${undoLabel}）`} className="flex shrink-0 items-center gap-1 rounded-2xl bg-white px-4 text-sm font-medium shadow-lg">
            <Undo2 className="size-4" /> 復原
          </button>
        )}
        {register.carts.length > 1 && (
          <button
            onClick={switchToNext}
            aria-label={`切換到下一張單（目前${CART_STYLES[register.active].name}單，共 ${register.carts.length} 張）`}
            className="flex shrink-0 items-center gap-1 rounded-2xl bg-white px-3 shadow-lg"
          >
            {register.carts.map(c => (
              <span key={c.color} className={`rounded-full ${CART_STYLES[c.color].dot} ${c.color === register.active ? 'size-4' : 'size-2.5 opacity-60'}`} />
            ))}
          </button>
        )}
        <button
          onClick={() => setCartOpen(true)}
          disabled={itemCount === 0}
          className="flex min-w-0 flex-1 items-center justify-between rounded-2xl bg-stone-900 px-5 py-4 text-white shadow-lg disabled:bg-stone-400"
        >
          <span className="flex items-center gap-2">
            {register.carts.length > 1 ? <span className={`size-3 rounded-full ${CART_STYLES[register.active].dot}`} /> : <ShoppingCart className="size-5" />} {itemCount} 件
          </span>
          <span className="text-xl font-bold">${pricing.total}</span>
        </button>
      </div>
      {cartOpen && itemCount > 0 && (
        <Modal title="購物車" onClose={() => setCartOpen(false)}>
          {cartPanel}
        </Modal>
      )}

      {editingPrice && (
        <ManualPriceDialog
          product={products.find(p => p.id === editingPrice)!}
          current={cart.find(i => i.productId === editingPrice)?.manualUnitPrice}
          onSave={price => {
            dispatch({ type: 'setManualPrice', productId: editingPrice, price });
            setEditingPrice(null);
          }}
          onClose={() => setEditingPrice(null)}
        />
      )}

      {enteringCode && (
        <CodeEntryDialog
          onSubmit={code => {
            setEnteringCode(false);
            addByCode(code);
          }}
          onClose={() => setEnteringCode(false)}
        />
      )}

      {cameraOpen && <CameraScanner onCode={addByCode} onClose={() => setCameraOpen(false)} />}

      {checkingOut && (
        <CheckoutDialog
          cart={cart}
          rules={rules}
          onAddProducts={addProducts}
          onPickCategory={pickCategory}
          onClose={() => setCheckingOut(false)}
          onPark={canPark ? park : undefined}
          onDone={orderNo => {
            dispatchRegister({ type: 'checkedOut' });
            setCheckingOut(false);
            setCartOpen(false);
            onCheckedOut(orderNo);
          }}
        />
      )}
    </div>
  );
}

// 掛單的標籤列：每張單一個顏色，點一下切換；「掛單」把目前這張收起來、換一張空的
function CartTabs(props: { register: RegisterState; canPark: boolean; onPark: () => void; onSwitch: (color: CartColor) => void }) {
  const { carts, active } = props.register;
  if (carts.length < 2 && !props.canPark) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {carts.length > 1 &&
        carts.map(c => {
          const count = c.cart.items.reduce((sum, i) => sum + i.quantity, 0);
          return (
            <button
              key={c.color}
              onClick={() => props.onSwitch(c.color)}
              aria-pressed={c.color === active}
              aria-label={`${CART_STYLES[c.color].name}單，${count} 件`}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ${c.color === active ? `bg-white font-bold ring-2 ${CART_STYLES[c.color].ring}` : 'bg-stone-100 text-stone-600'}`}
            >
              <span className={`size-3 rounded-full ${CART_STYLES[c.color].dot}`} /> {count} 件
            </button>
          );
        })}
      {props.canPark && (
        <button onClick={props.onPark} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-stone-100 px-3 py-1.5 text-sm font-medium">
          <Pause className="size-4" /> 掛單
        </button>
      )}
    </div>
  );
}

function CartPanel(props: {
  register: RegisterState;
  canPark: boolean;
  onPark: () => void;
  onSwitch: (color: CartColor) => void;
  cart: CartState['items'];
  undoLabel: string | null;
  onUndo: () => void;
  onAddProducts: (productIds: string[]) => void;
  onPickCategory: (category: string) => void;
  pricing: ReturnType<typeof priceCart>;
  products: ReturnType<typeof useCatalog>['products'];
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
  onEditPrice: (id: string) => void;
  onClear: () => void;
  onCheckout: () => void;
}) {
  const { cart, pricing, products } = props;
  const extras = pricing.lines.filter(l => l.lineType !== '商品');

  const undoButton = props.undoLabel && (
    <button onClick={props.onUndo} className="inline-flex items-center gap-1 self-start rounded-lg bg-stone-100 px-3 py-1.5 text-sm font-medium">
      <Undo2 className="size-4" /> 復原（{props.undoLabel}）
    </button>
  );

  const tabs = <CartTabs register={props.register} canPark={props.canPark} onPark={props.onPark} onSwitch={props.onSwitch} />;

  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center text-stone-500">
        {tabs}
        點商品加入購物車
        {undoButton}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 lg:sticky lg:top-4">
      {tabs}
      {undoButton}
      <ul className="divide-y divide-stone-100">
        {cart.map(item => {
          const product = products.find(p => p.id === item.productId);
          if (!product) return null;
          const unitPrice = item.manualUnitPrice ?? product.price;
          return (
            <li key={item.productId} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{product.name}</p>
                <button onClick={() => props.onEditPrice(item.productId)} aria-label={`改價：${product.name}`} className="text-sm text-stone-500 underline decoration-dotted">
                  ${unitPrice}
                  {item.manualUnitPrice !== undefined && <span className="ml-1 text-amber-700">（改價，原 ${product.price}）</span>}
                </button>
              </div>
              <button onClick={() => props.onDecrement(item.productId)} className="flex size-10 items-center justify-center rounded-lg bg-stone-100" aria-label="減少">
                <Minus className="size-4" />
              </button>
              <span className="w-6 text-center font-bold">{item.quantity}</span>
              <button onClick={() => props.onIncrement(item.productId)} className="flex size-10 items-center justify-center rounded-lg bg-stone-100" aria-label="增加">
                <Plus className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>

      {extras.length > 0 && (
        <ul className="space-y-1 border-t border-stone-100 pt-2 text-sm">
          {extras.map((l, i) => (
            <li key={i} className={`flex justify-between ${l.lineType === '贈品' ? 'text-emerald-700' : 'text-rose-700'}`}>
              <span className="flex items-center gap-1">
                {l.lineType === '贈品' && <Gift className="size-4" />}
                {l.lineType === '贈品' ? `${l.itemName} ×${l.quantity}（${l.description}）` : l.description}
              </span>
              <span>{l.lineType === '贈品' ? '贈' : `−$${-l.subtotal}`}</span>
            </li>
          ))}
        </ul>
      )}

      <BundleHints
        hints={pricing.bundleHints}
        onAddProducts={props.onAddProducts}
        onPickCategory={props.onPickCategory}
      />

      {pricing.nextPromotion && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          再買 ${pricing.nextPromotion.remaining} 可享「{pricing.nextPromotion.name}」
        </p>
      )}

      <div className="flex items-baseline justify-between border-t border-stone-100 pt-2">
        <span className="text-stone-600">合計</span>
        <span className="text-3xl font-bold">${pricing.total}</span>
      </div>

      <div className="flex gap-2">
        <button onClick={props.onClear} className="flex size-14 items-center justify-center rounded-xl bg-stone-100" aria-label="清空購物車">
          <Trash2 className="size-5" />
        </button>
        <button onClick={props.onCheckout} className="h-14 flex-1 rounded-xl bg-stone-900 text-lg font-bold text-white">
          結帳
        </button>
      </div>
    </div>
  );
}

function ManualPriceDialog(props: {
  product: { name: string; price: number };
  current?: number;
  onSave: (price?: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(String(props.current ?? props.product.price));
  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  return (
    <Modal title={`改價：${props.product.name}`} onClose={props.onClose}>
      <p className="text-sm text-stone-500">原價 ${props.product.price}。改價的品項不會參與組合價。</p>
      <input
        type="number"
        inputMode="none"
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        className="mt-3 mb-3 w-full rounded-xl border border-stone-300 px-4 py-3 text-2xl font-bold"
      />
      <NumericKeypad value={value} onChange={setValue} />
      <div className="mt-4 flex gap-2">
        {props.current !== undefined && (
          <button onClick={() => props.onSave(undefined)} className="h-12 flex-1 rounded-xl bg-stone-100 font-medium">
            恢復原價
          </button>
        )}
        <button
          onClick={() => props.onSave(parsed === props.product.price ? undefined : parsed)}
          disabled={!valid}
          className="h-12 flex-1 rounded-xl bg-stone-900 font-bold text-white disabled:opacity-40"
        >
          確定
        </button>
      </div>
    </Modal>
  );
}

// 掃不到條碼時，看標籤上印的數字手動輸入
function CodeEntryDialog({ onSubmit, onClose }: { onSubmit: (code: string) => void; onClose: () => void }) {
  const [code, setCode] = useState('');
  return (
    <Modal title="輸入商品代碼" onClose={onClose}>
      <input
        inputMode="none"
        autoFocus
        value={code}
        onChange={e => setCode(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && code.trim() && onSubmit(code)}
        placeholder="標籤上的數字"
        className="mb-3 w-full rounded-xl border border-stone-300 px-4 py-3 text-center font-mono text-3xl font-bold tracking-widest"
      />
      <NumericKeypad value={code} onChange={setCode} maxLength={20} />
      <button onClick={() => onSubmit(code)} disabled={!code.trim()} className="mt-3 h-14 w-full rounded-xl bg-stone-900 text-lg font-bold text-white disabled:opacity-40">
        加入購物車
      </button>
    </Modal>
  );
}
