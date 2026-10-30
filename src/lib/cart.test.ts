import { describe, expect, it } from 'vitest';
import { cartStateReducer, EMPTY_CART, MAX_UNDO, type CartState, type CartStateAction } from './cart';

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
