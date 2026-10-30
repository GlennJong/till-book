import { describe, expect, it } from 'vitest';
import { buildRules, priceCart, type CartItem } from './pricing';
import type { BundleRecord, Product, PromotionRecord } from './types';

const product = (id: string, price: number, category = '未分類'): Product => ({
  id,
  name: id,
  price,
  category,
  code: '',
  imageUrl: '',
  totalStock: null,
  serverOnSite: null,
  serverStock: null
});

const PRODUCTS = [
  product('A', 150, '本子'),
  product('B', 120, '本子'),
  product('C', 100, '本子'),
  product('D', 80, '本子'),
  product('吊飾', 120, '吊飾'),
  product('貼紙', 30, '贈品'),
  product('海報', 100, '贈品')
];

const bundle = (name: string, bundlePrice: number, items: string[], pickCount: number | null = null): BundleRecord => ({
  name,
  bundlePrice,
  items,
  pickCount
});

const promo = (name: string, threshold: number, fields: Partial<PromotionRecord> = {}): PromotionRecord => ({
  name,
  threshold,
  discountAmount: 0,
  gifts: [],
  ...fields
});

const cart = (...ids: string[]): CartItem[] => {
  const counts = new Map<string, number>();
  ids.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
  return [...counts].map(([productId, quantity]) => ({ productId, quantity }));
};

const price = (items: CartItem[], bundles: BundleRecord[] = [], promotions: PromotionRecord[] = [], manualTotal?: number) =>
  priceCart(items, buildRules(PRODUCTS, bundles, promotions), manualTotal);

const descriptions = (r: ReturnType<typeof price>) => r.lines.filter(l => l.lineType !== '商品').map(l => `${l.lineType} ${l.description} ${l.subtotal}`);

describe('items', () => {
  it('sums list prices', () => {
    const r = price(cart('A', 'A', 'B'));
    expect(r.total).toBe(420);
    expect(r.lines).toHaveLength(2);
  });

  it('uses manual prices and marks them', () => {
    const r = price([{ productId: 'A', quantity: 2, manualUnitPrice: 100 }]);
    expect(r.total).toBe(200);
    expect(r.lines[0]).toMatchObject({ listPrice: 150, unitPrice: 100, description: '手動改價' });
  });
});

describe('bundles', () => {
  it('applies a fixed bundle as many times as possible', () => {
    const r = price(cart('A', 'B', 'A', 'B', 'A'), [bundle('A+B', 250, ['A', 'B'])]);
    expect(descriptions(r)).toEqual(['折扣 組合：A+B -20', '折扣 組合：A+B -20']);
    expect(r.total).toBe(150 * 3 + 120 * 2 - 40);
  });

  it('requires duplicated items twice', () => {
    const rules = [bundle('兩個吊飾', 200, ['吊飾', '吊飾'])];
    expect(price(cart('吊飾'), rules).total).toBe(120);
    expect(price(cart('吊飾', '吊飾'), rules).total).toBe(200);
  });

  it('picks the most expensive items for pick-N bundles (spec example: $380)', () => {
    const r = price(cart('A', 'B', 'C', 'D'), [bundle('本子任選 3', 300, ['【分類】本子'], 3)]);
    expect(r.total).toBe(380);
  });

  it('chooses the combination that is cheapest for the customer, not the first rule', () => {
    // A+B 套組 只省 20；任選 2 本 $200 用在 A+B 省 70
    const rules = [bundle('A+B', 250, ['A', 'B']), bundle('任選 2', 200, ['【分類】本子'], 2)];
    expect(price(cart('A', 'B'), rules).total).toBe(200);
  });

  it('combines non-overlapping bundles', () => {
    const rules = [bundle('任選 2', 200, ['【分類】本子'], 2), bundle('兩個吊飾', 200, ['吊飾', '吊飾'])];
    expect(price(cart('A', 'B', '吊飾', '吊飾'), rules).total).toBe(400);
  });

  it('never applies a bundle that costs more than buying separately', () => {
    expect(price(cart('D', 'D'), [bundle('任選 2', 200, ['【分類】本子'], 2)]).total).toBe(160);
  });

  it('skips manually priced items', () => {
    const items = [{ productId: 'A', quantity: 1, manualUnitPrice: 150 }, { productId: 'B', quantity: 1 }];
    expect(price(items, [bundle('A+B', 200, ['A', 'B'])]).total).toBe(270);
  });

  it('allows category slots inside fixed bundles', () => {
    const r = price(cart('A', '吊飾'), [bundle('一本一吊飾', 220, ['【分類】本子', '吊飾'])]);
    expect(r.total).toBe(220);
  });

  it('disables bundles with unknown items and reports them', () => {
    const rules = buildRules(PRODUCTS, [bundle('壞組合', 100, ['不存在'])], []);
    expect(rules.bundles).toHaveLength(0);
    expect(rules.warnings).toEqual(['組合「壞組合」找不到品項：不存在，已停用']);
  });

  it('falls back to greedy for very large carts without hanging', () => {
    const many = Array.from({ length: 60 }, (_, i) => ['A', 'B', 'C', 'D'][i % 4]);
    const rules = [bundle('A+B', 250, ['A', 'B']), bundle('任選 2', 230, ['【分類】本子'], 2), bundle('任選 3', 300, ['【分類】本子'], 3)];
    const r = price(cart(...many), rules);
    expect(r.total).toBeLessThan(r.itemsTotal);
  });
});

describe('promotions (always tiered)', () => {
  it('applies only the highest threshold reached', () => {
    const promos = [
      promo('滿 300 送海報', 300, { gifts: ['海報'] }), // 低階贈品比較貴，仍以門檻為準
      promo('滿 600 送貼紙', 600, { gifts: ['貼紙'] }),
      promo('滿 1000 折 120', 1000, { discountAmount: 120 })
    ];
    expect(descriptions(price(cart('A', 'A', 'A', 'A'), [], promos))).toEqual(['贈品 活動：滿 600 送貼紙 0']);
    expect(descriptions(price(cart('A', 'A', 'A'), [], promos))).toEqual(['贈品 活動：滿 300 送海報 0']);
    expect(descriptions(price(cart('A', 'A', 'A', 'A', 'A', 'A', 'A'), [], promos))).toEqual(['折扣 活動：滿 1000 折 120 -120']);
  });

  it('combines every row that shares the top threshold', () => {
    const promos = [promo('滿 500 折 50', 500, { discountAmount: 50 }), promo('滿 500 送貼紙', 500, { gifts: ['貼紙'] })];
    const r = price(cart('A', 'A', 'A', 'A'), [], promos);
    expect(descriptions(r)).toEqual(['折扣 活動：滿 500 折 50 -50', '贈品 活動：滿 500 送貼紙 0']);
    expect(r.total).toBe(550);
  });

  it('gives several gifts from one row, repeated names as quantity', () => {
    const r = price(cart('A', 'A', 'A'), [], [promo('滿 300 送貼紙×2＋海報', 300, { gifts: ['貼紙', '海報', '貼紙'] })]);
    expect(r.lines.filter(l => l.lineType === '贈品').map(l => [l.productId, l.quantity])).toEqual([['貼紙', 2], ['海報', 1]]);
  });

  it('compares thresholds against the subtotal after bundles', () => {
    const r = price(cart('A', 'B'), [bundle('A+B', 250, ['A', 'B'])], [promo('滿 270 送貼紙', 270, { gifts: ['貼紙'] })]);
    expect(r.subtotal).toBe(250);
    expect(r.lines.some(l => l.lineType === '贈品')).toBe(false);
    expect(r.nextPromotion).toEqual({ name: '滿 270 送貼紙', remaining: 20 });
  });

  it('warns when a gift is not a product', () => {
    expect(buildRules(PRODUCTS, [], [promo('送神秘禮', 100, { gifts: ['神秘禮'] })]).warnings).toEqual([
      '活動「送神秘禮」的贈品「神秘禮」不在商品中'
    ]);
  });
});

describe('manual total', () => {
  it('adds an order-level adjustment line', () => {
    const r = price(cart('A', 'B'), [], [], 250);
    expect(descriptions(r)).toEqual(['折扣 整單改價 -20']);
    expect(r.total).toBe(250);
  });

  it('keeps the ledger invariant: lines sum to the total', () => {
    const r = price(cart('A', 'B', 'C', '吊飾'), [bundle('任選 2', 200, ['【分類】本子'], 2)], [promo('滿 300 折 30', 300, { discountAmount: 30 })], 400);
    expect(r.lines.reduce((s, l) => s + l.subtotal, 0)).toBe(r.total);
  });
});

describe('legacy data', () => {
  it('normalizes promotions returned by scripts older than 1.2.0', async () => {
    const { normalizePromotion } = await import('./catalog');
    expect(normalizePromotion({ name: '舊', threshold: 300, discountAmount: 0, giftName: '貼紙', giftQuantity: 2 })).toEqual({
      name: '舊',
      threshold: 300,
      discountAmount: 0,
      gifts: ['貼紙', '貼紙']
    });
  });

  it('does not crash on promotions cached without gifts', () => {
    const stale = { name: '舊快取', threshold: 100, discountAmount: 10 } as unknown as PromotionRecord;
    expect(() => buildRules(PRODUCTS, [], [stale])).not.toThrow();
  });
});
