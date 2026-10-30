import type { CartItem } from './pricing';

export type CartAction =
  | { type: 'add'; productId: string }
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
