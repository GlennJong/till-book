import type { CartItem } from './pricing';

export type CartAction =
  | { type: 'add'; productId: string }
  | { type: 'addMany'; productIds: string[] } // 湊組合：一次加入多件，復原時算一步
  | { type: 'decrement'; productId: string }
  | { type: 'remove'; productId: string }
  | { type: 'setManualPrice'; productId: string; price?: number }
  | { type: 'clear' };

export function cartReducer(cart: CartItem[], action: CartAction): CartItem[] {
  switch (action.type) {
    case 'add': {
      const existing = cart.find(i => i.productId === action.productId);
      if (!existing) return [...cart, { productId: action.productId, quantity: 1 }];
      return cart.map(i => (i.productId === action.productId ? { ...i, quantity: i.quantity + 1 } : i));
    }
    case 'addMany':
      return action.productIds.reduce((items, productId) => cartReducer(items, { type: 'add', productId }), cart);
    case 'decrement':
      return cart
        .map(i => (i.productId === action.productId ? { ...i, quantity: i.quantity - 1 } : i))
        .filter(i => i.quantity > 0);
    case 'remove':
      return cart.filter(i => i.productId !== action.productId);
    case 'setManualPrice':
      return cart.map(i => (i.productId === action.productId ? { ...i, manualUnitPrice: action.price } : i));
    case 'clear':
      return [];
  }
}

// 購物車 + 復原紀錄：記住最近 MAX_UNDO 步操作前的購物車，可以一步步往回退
// 結帳完成（reset）後清空紀錄；已結帳的單據要用沖銷處理

export const MAX_UNDO = 20;

export interface CartState {
  items: CartItem[];
  history: { items: CartItem[]; action: CartAction }[];
}

export type CartStateAction = CartAction | { type: 'undo' } | { type: 'reset' };

export const EMPTY_CART: CartState = { items: [], history: [] };

export function cartStateReducer(state: CartState, action: CartStateAction): CartState {
  if (action.type === 'undo') {
    const last = state.history.at(-1);
    return last ? { items: last.items, history: state.history.slice(0, -1) } : state;
  }
  if (action.type === 'reset') return EMPTY_CART;

  const items = cartReducer(state.items, action);
  // 沒有改變的操作（例如清空空的購物車）不記進復原紀錄
  if (JSON.stringify(items) === JSON.stringify(state.items)) return state;
  return { items, history: [...state.history, { items: state.items, action }].slice(-MAX_UNDO) };
}

// 掛單：同時保留多張購物車，以顏色區分（見 spec UI 14）
// 客人還在挑時先把這張掛起，幫下一位結帳；每張單各自保留內容與復原紀錄
// 掛起的單會占用庫存，切換到別張時留下的空單直接丟掉

export const CART_COLORS = ['sky', 'amber', 'rose', 'violet', 'lime'] as const;
export type CartColor = (typeof CART_COLORS)[number];
export const MAX_CARTS = CART_COLORS.length;

export interface RegisterState {
  carts: { color: CartColor; cart: CartState }[];
  active: CartColor;
}

export type RegisterAction =
  | { type: 'cart'; action: CartStateAction } // 作用在目前這張單
  | { type: 'park' } // 掛起目前這張，換一張空的
  | { type: 'switch'; color: CartColor }
  | { type: 'checkedOut' } // 目前這張結帳完成，切回還在等的單
  | { type: 'hydrate'; state: RegisterState };

export const EMPTY_REGISTER: RegisterState = { carts: [{ color: CART_COLORS[0], cart: EMPTY_CART }], active: CART_COLORS[0] };

export const activeCart = (state: RegisterState) => state.carts.find(c => c.color === state.active)!.cart;

const newCart = (carts: RegisterState['carts']) => {
  const color = CART_COLORS.find(c => !carts.some(x => x.color === c));
  return color ? { color, cart: EMPTY_CART } : null;
};

// 離開某張單時，空的單不留著
const leave = (state: RegisterState) => state.carts.filter(c => c.color !== state.active || c.cart.items.length > 0);

export function registerReducer(state: RegisterState, action: RegisterAction): RegisterState {
  switch (action.type) {
    case 'cart':
      return { ...state, carts: state.carts.map(c => (c.color === state.active ? { ...c, cart: cartStateReducer(c.cart, action.action) } : c)) };
    case 'park': {
      if (activeCart(state).items.length === 0) return state;
      const fresh = newCart(state.carts);
      if (!fresh) return state;
      return { carts: [...state.carts, fresh], active: fresh.color };
    }
    case 'switch': {
      if (action.color === state.active || !state.carts.some(c => c.color === action.color)) return state;
      return { carts: leave(state), active: action.color };
    }
    case 'checkedOut': {
      const rest = state.carts.filter(c => c.color !== state.active);
      if (rest.length > 0) return { carts: rest, active: rest[0].color };
      return EMPTY_REGISTER;
    }
    case 'hydrate':
      return action.state.carts.some(c => c.color === action.state.active) ? action.state : state;
  }
}

// 某商品在其他（掛起的）單裡的件數，算剩餘庫存時要扣掉
export const reservedElsewhere = (state: RegisterState, productId: string) =>
  state.carts
    .filter(c => c.color !== state.active)
    .reduce((sum, c) => sum + (c.cart.items.find(i => i.productId === productId)?.quantity ?? 0), 0);
