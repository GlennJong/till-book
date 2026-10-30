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
