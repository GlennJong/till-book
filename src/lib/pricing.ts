import type { BundleRecord, OrderLine, Product, PromotionRecord } from './types';

// 計價管線：組合價最佳化 → 滿額活動 → 整單改價（見 spec 6.1）
// 所有規則都自動對客人取最優，使用者不需要設定優先順序

export const CATEGORY_PREFIX = '【分類】';

export interface CartItem {
  productId: string;
  quantity: number;
  manualUnitPrice?: number; // 手動改價；改過的品項不參與組合
}

// 組合以「格子」表示：固定組合每個品項一格，任選 N 件就是 N 格，每格可放的商品集合
export interface BundleRule {
  name: string;
  bundlePrice: number;
  slots: Set<string>[];
}

export interface PromotionRule {
  name: string;
  threshold: number;
  discountAmount: number;
  gifts: { productId: string; quantity: number }[];
}

export interface PricingRules {
  products: Map<string, Product>;
  bundles: BundleRule[];
  promotions: PromotionRule[];
  warnings: string[];
}

export interface PricingResult {
  lines: OrderLine[];
  itemsTotal: number;  // 商品成交價合計
  subtotal: number;    // 扣除組合折抵後，用來判定滿額門檻
  total: number;       // 應收金額
  nextPromotion?: { name: string; remaining: number }; // 最近一個還沒達到的活動
}

// ---------- 規則建立 ----------

export function buildRules(products: Product[], bundles: BundleRecord[], promotions: PromotionRecord[]): PricingRules {
  const warnings: string[] = [];
  const byId = new Map(products.map(p => [p.id, p]));
  const byName = new Map(products.map(p => [p.name, p]));

  const resolveItem = (item: string): Set<string> | null => {
    if (byName.has(item)) return new Set([byName.get(item)!.id]);
    if (item.startsWith(CATEGORY_PREFIX)) {
      const category = item.slice(CATEGORY_PREFIX.length);
      const ids = products.filter(p => p.categories.includes(category)).map(p => p.id);
      return ids.length > 0 ? new Set(ids) : null;
    }
    return null;
  };

  const bundleRules: BundleRule[] = [];
  bundles.forEach(bundle => {
    const resolved = bundle.items.map(item => ({ item, ids: resolveItem(item) }));
    const missing = resolved.filter(r => !r.ids).map(r => r.item);
    if (missing.length > 0) {
      warnings.push(`組合「${bundle.name}」找不到品項：${missing.join('、')}，已停用`);
      return;
    }
    const sets = resolved.map(r => r.ids!);
    if (bundle.pickCount) {
      const pool = new Set(sets.flatMap(s => [...s]));
      bundleRules.push({ name: bundle.name, bundlePrice: bundle.bundlePrice, slots: Array.from({ length: bundle.pickCount }, () => pool) });
    } else {
      bundleRules.push({ name: bundle.name, bundlePrice: bundle.bundlePrice, slots: sets });
    }
  });

  const promotionRules: PromotionRule[] = [];
  promotions.forEach(promo => {
    const counts = new Map<string, number>();
    (promo.gifts ?? []).forEach(giftName => {
      const product = byName.get(giftName);
      if (product) counts.set(product.id, (counts.get(product.id) ?? 0) + 1);
      else warnings.push(`活動「${promo.name}」的贈品「${giftName}」不在商品中`);
    });
    const gifts = [...counts].map(([productId, quantity]) => ({ productId, quantity }));
    if (gifts.length === 0 && !promo.discountAmount) return;
    promotionRules.push({
      name: promo.name,
      threshold: promo.threshold,
      discountAmount: promo.discountAmount,
      gifts
    });
  });

  return { products: byId, bundles: bundleRules, promotions: promotionRules, warnings };
}

// ---------- 組合價最佳化 ----------

interface BundleApplication {
  rule: BundleRule;
  units: string[];     // 進組合的商品（可重複）
  listTotal: number;
  saving: number;
}

const MAX_SEARCH_NODES = 5000;

class SearchLimitError extends Error {}

const countsKey = (counts: Map<string, number>) =>
  [...counts.entries()].filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)).map(([id, n]) => `${id}:${n}`).join('|');

// 嘗試套用一次組合：限制最多的格子先填，每格挑定價最高的商品（對客人最有利）
function tryApply(rule: BundleRule, counts: Map<string, number>, prices: Map<string, number>): BundleApplication | null {
  const remaining = new Map(counts);
  const units: string[] = [];
  const slots = [...rule.slots].sort((a, b) => a.size - b.size);

  for (const slot of slots) {
    let best: string | null = null;
    for (const id of slot) {
      if ((remaining.get(id) ?? 0) <= 0) continue;
      if (best === null || prices.get(id)! > prices.get(best)! || (prices.get(id) === prices.get(best) && id < best)) best = id;
    }
    if (best === null) return null;
    remaining.set(best, remaining.get(best)! - 1);
    units.push(best);
  }

  const listTotal = units.reduce((sum, id) => sum + prices.get(id)!, 0);
  const saving = listTotal - rule.bundlePrice;
  return saving > 0 ? { rule, units, listTotal, saving } : null;
}

const without = (counts: Map<string, number>, units: string[]) => {
  const next = new Map(counts);
  units.forEach(id => next.set(id, next.get(id)! - 1));
  return next;
};

function optimizeBundles(counts: Map<string, number>, rules: BundleRule[], prices: Map<string, number>): BundleApplication[] {
  const memo = new Map<string, { saving: number; apps: BundleApplication[] }>();
  let nodes = 0;

  const search = (current: Map<string, number>): { saving: number; apps: BundleApplication[] } => {
    const key = countsKey(current);
    const cached = memo.get(key);
    if (cached) return cached;
    if (++nodes > MAX_SEARCH_NODES) throw new SearchLimitError();

    let best = { saving: 0, apps: [] as BundleApplication[] };
    for (const rule of rules) {
      const app = tryApply(rule, current, prices);
      if (!app) continue;
      const rest = search(without(current, app.units));
      if (app.saving + rest.saving > best.saving) best = { saving: app.saving + rest.saving, apps: [app, ...rest.apps] };
    }
    memo.set(key, best);
    return best;
  };

  try {
    return search(counts).apps;
  } catch (err) {
    if (!(err instanceof SearchLimitError)) throw err;
    // 安全閥：改用「每次套用折抵最多的組合」
    const apps: BundleApplication[] = [];
    let current = counts;
    for (;;) {
      const candidates = rules.map(rule => tryApply(rule, current, prices)).filter((a): a is BundleApplication => a !== null);
      if (candidates.length === 0) return apps;
      const app = candidates.reduce((a, b) => (b.saving > a.saving ? b : a));
      apps.push(app);
      current = without(current, app.units);
    }
  }
}

// ---------- 計價 ----------

export function priceCart(cart: CartItem[], rules: PricingRules, manualTotal?: number): PricingResult {
  const prices = new Map([...rules.products.values()].map(p => [p.id, p.price]));
  const lines: OrderLine[] = [];

  const counts = new Map<string, number>();
  cart.forEach(item => {
    const product = rules.products.get(item.productId);
    if (!product || item.quantity <= 0) return;
    const manual = item.manualUnitPrice !== undefined;
    const unitPrice = manual ? item.manualUnitPrice! : product.price;
    lines.push({
      lineType: '商品',
      productId: product.id,
      itemName: product.name,
      quantity: item.quantity,
      listPrice: product.price,
      unitPrice,
      subtotal: unitPrice * item.quantity,
      description: manual ? '手動改價' : ''
    });
    if (!manual) counts.set(product.id, (counts.get(product.id) ?? 0) + item.quantity);
  });
  const itemsTotal = lines.reduce((sum, l) => sum + l.subtotal, 0);

  // 階段一：組合價
  optimizeBundles(counts, rules.bundles, prices).forEach(app => {
    lines.push(discountLine(app.rule.name, app.saving, `組合：${app.rule.name}`));
  });
  const subtotal = lines.reduce((sum, l) => sum + l.subtotal, 0);

  // 階段二：滿額活動（一律階梯式）：只給達到的最高門檻那一階；同門檻的多列一起給
  const reached = rules.promotions.filter(p => p.threshold <= subtotal);
  const topThreshold = Math.max(...reached.map(p => p.threshold));
  const applied = reached.filter(p => p.threshold === topThreshold);

  applied.forEach(p => {
    if (p.discountAmount > 0) lines.push(discountLine(p.name, p.discountAmount, `活動：${p.name}`));
    p.gifts.forEach(g => {
      const gift = rules.products.get(g.productId)!;
      lines.push({
        lineType: '贈品',
        productId: gift.id,
        itemName: gift.name,
        quantity: g.quantity,
        listPrice: gift.price,
        unitPrice: 0,
        subtotal: 0,
        description: `活動：${p.name}`
      });
    });
  });

  // 階段三：整單改價
  const beforeManual = lines.reduce((sum, l) => sum + l.subtotal, 0);
  if (manualTotal !== undefined && manualTotal !== beforeManual && lines.length > 0) {
    lines.push(discountLine('整單改價', beforeManual - manualTotal, '整單改價'));
  }

  const total = Math.max(0, lines.reduce((sum, l) => sum + l.subtotal, 0));
  const upcoming = rules.promotions
    .filter(p => p.threshold > subtotal)
    .sort((a, b) => a.threshold - b.threshold)[0];

  return {
    lines,
    itemsTotal,
    subtotal,
    total,
    nextPromotion: upcoming && lines.length > 0 ? { name: upcoming.name, remaining: upcoming.threshold - subtotal } : undefined
  };
}

const discountLine = (name: string, amount: number, description: string): OrderLine => ({
  lineType: '折扣',
  productId: '',
  itemName: name,
  quantity: 1,
  listPrice: 0,
  unitPrice: -amount,
  subtotal: -amount,
  description
});
