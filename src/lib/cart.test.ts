import { describe, expect, it } from 'vitest';
import {
  activeCart,
  cartStateReducer,
  EMPTY_CART,
  EMPTY_REGISTER,
  MAX_CARTS,
  MAX_UNDO,
  registerReducer,
  reservedElsewhere,
  type CartState,
  type CartStateAction,
  type RegisterAction
} from './cart';

const run = (actions: CartStateAction[], start: CartState = EMPTY_CART) => actions.reduce(cartStateReducer, start);

describe('cart undo', () => {
  it('steps back through adds, price changes and clear', () => {
    let state = run([
      { type: 'add', productId: 'A' },
      { type: 'add', productId: 'A' },
      { type: 'setManualPrice', productId: 'A', price: 150 },
      { type: 'clear' }
    ]);
    expect(state.items).toEqual([]);
    expect(state.history.at(-1)!.action.type).toBe('clear');

    state = cartStateReducer(state, { type: 'undo' });
    expect(state.items).toEqual([{ productId: 'A', quantity: 2, manualUnitPrice: 150 }]);
    state = run([{ type: 'undo' }, { type: 'undo' }], state);
    expect(state.items).toEqual([{ productId: 'A', quantity: 1 }]);
    state = run([{ type: 'undo' }, { type: 'undo' }], state);
    expect(state).toEqual(EMPTY_CART);
  });

  it('does not record no-op actions and keeps only the last steps', () => {
    expect(run([{ type: 'clear' }, { type: 'decrement', productId: 'X' }])).toBe(EMPTY_CART);
    const many = run(Array.from({ length: MAX_UNDO + 5 }, () => ({ type: 'add', productId: 'A' }) as const));
    expect(many.history).toHaveLength(MAX_UNDO);
  });

  it('reset after checkout clears items and history', () => {
    expect(run([{ type: 'add', productId: 'A' }, { type: 'reset' }])).toEqual(EMPTY_CART);
  });
});

describe('parked carts', () => {
  const play = (actions: RegisterAction[]) => actions.reduce(registerReducer, EMPTY_REGISTER);
  const add = (productId: string): RegisterAction => ({ type: 'cart', action: { type: 'add', productId } });

  it('parks the current cart, serves the next one, then returns to the parked cart after checkout', () => {
    let state = play([add('A'), add('A'), { type: 'park' }, add('B')]);
    expect(state.carts.map(c => c.color)).toEqual(['sky', 'amber']);
    expect(state.active).toBe('amber');
    expect(activeCart(state).items).toEqual([{ productId: 'B', quantity: 1 }]);
    // 掛起的單占用庫存
    expect(reservedElsewhere(state, 'A')).toBe(2);
    expect(reservedElsewhere(state, 'B')).toBe(0);

    state = registerReducer(state, { type: 'checkedOut' });
    expect(state.carts.map(c => c.color)).toEqual(['sky']);
    expect(activeCart(state).items).toEqual([{ productId: 'A', quantity: 2 }]);
    // 復原紀錄跟著各自的單
    expect(activeCart(state).history).toHaveLength(2);
  });

  it('drops an empty cart when switching away and does not park an empty cart', () => {
    let state = play([add('A'), { type: 'park' }]);
    expect(registerReducer(state, { type: 'park' })).toBe(state);
    state = registerReducer(state, { type: 'switch', color: 'sky' });
    expect(state.carts.map(c => c.color)).toEqual(['sky']);
    expect(registerReducer(EMPTY_REGISTER, { type: 'checkedOut' })).toEqual(EMPTY_REGISTER);
  });

  it('reuses freed colors and caps the number of carts', () => {
    const full = play(Array.from({ length: MAX_CARTS + 2 }, () => [add('A'), { type: 'park' } as RegisterAction]).flat());
    expect(full.carts).toHaveLength(MAX_CARTS);
    const afterCheckout = play([add('A'), { type: 'park' }, add('B'), { type: 'park' }, { type: 'switch', color: 'sky' }, { type: 'checkedOut' }, add('C'), { type: 'park' }]);
    expect(afterCheckout.carts.map(c => c.color)).toEqual(['amber', 'sky']);
  });
});
