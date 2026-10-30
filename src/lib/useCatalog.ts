import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting } from './db';
import { availableOnSite, availableStock } from './outbox';
import { buildRules } from './pricing';

// 收銀畫面需要的本機資料：商品、計價規則、可用庫存與現場剩餘、待同步筆數
export function useCatalog() {
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const bundles = useLiveQuery(() => db.bundles.toArray(), []) ?? [];
  const promotions = useLiveQuery(() => db.promotions.toArray(), []) ?? [];
  const unsynced = useLiveQuery(() => db.outbox.where('status').notEqual('SYNCED').toArray(), []) ?? [];
  const sheetWarnings = useLiveQuery(() => getSetting<string[]>('catalogWarnings'), []) ?? [];
  const syncedAt = useLiveQuery(() => getSetting<string>('catalogSyncedAt'), []);

  const rules = useMemo(() => buildRules(products, bundles, promotions), [products, bundles, promotions]);
  const stock = useMemo(() => availableStock(products, unsynced), [products, unsynced]);
  const onSite = useMemo(() => availableOnSite(products, unsynced), [products, unsynced]);
  const categories = useMemo(() => [...new Set(products.flatMap(p => p.categories))], [products]);

  return {
    products,
    rules,
    stock,
    onSite,
    categories,
    pendingCount: unsynced.length,
    warnings: [...sheetWarnings, ...rules.warnings],
    syncedAt
  };
}
