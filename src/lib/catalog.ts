import { callScript } from './api';
import { db, setSetting } from './db';
import type { BootstrapResponse, PromotionRecord } from './types';

// 舊版腳本（1.0 / 1.1）的滿額活動只有單一贈品：giftName + giftQuantity
type LegacyPromotion = Partial<PromotionRecord> & { name: string; threshold: number; giftName?: string; giftQuantity?: number };

export const normalizePromotion = (p: LegacyPromotion): PromotionRecord => ({
  name: p.name,
  threshold: p.threshold,
  discountAmount: p.discountAmount ?? 0,
  gifts: p.gifts ?? (p.giftName ? Array.from({ length: p.giftQuantity || 1 }, () => p.giftName!) : [])
});

// 從試算表拉取商品、組合價、滿額活動，整批覆蓋本機快取
export async function refreshCatalog(scriptUrl: string) {
  const data = await callScript<BootstrapResponse>(scriptUrl, 'bootstrap');

  await db.transaction('rw', [db.products, db.bundles, db.promotions, db.settings], async () => {
    await Promise.all([db.products.clear(), db.bundles.clear(), db.promotions.clear()]);
    await db.products.bulkPut(
      data.products.map(({ currentStock, ...product }) => ({ ...product, serverStock: currentStock }))
    );
    await db.bundles.bulkPut(data.bundles);
    await db.promotions.bulkPut(data.promotions.map(normalizePromotion));
    await setSetting('catalogWarnings', data.warnings);
    await setSetting('catalogSyncedAt', data.serverTime);
    await setSetting('scriptVersion', data.scriptVersion ?? null);
  });

  return data;
}

// 切換帳本時清掉上一本的快取
export async function clearCatalog() {
  await db.transaction('rw', [db.products, db.bundles, db.promotions, db.settings, db.images], async () => {
    await Promise.all([db.products.clear(), db.bundles.clear(), db.promotions.clear(), db.images.clear()]);
    await db.settings.bulkDelete(['catalogWarnings', 'catalogSyncedAt', 'scriptVersion']);
  });
}
