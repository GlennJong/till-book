import Dexie, { type Table } from 'dexie';
import type { BundleRecord, OutboxOrder, Product, PromotionRecord } from './types';

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface ImageRecord {
  productId: string;
  sourceUrl: string;
  blob: Blob;
}

class TillDatabase extends Dexie {
  products!: Table<Product, string>;
  bundles!: Table<BundleRecord, string>;
  promotions!: Table<PromotionRecord, string>;
  outbox!: Table<OutboxOrder, string>;
  settings!: Table<SettingRecord, string>;
  images!: Table<ImageRecord, string>;

  constructor() {
    super('till');
    this.version(1).stores({
      products: 'id, category',
      bundles: 'name',
      promotions: 'name',
      outbox: 'orderNo, status, createdAt',
      settings: 'key',
      images: 'productId'
    });
    // seq：單據建立順序（同一毫秒內的結帳也能保持先後），同步時依此排序
    this.version(2).stores({
      outbox: 'orderNo, status, createdAt, seq'
    });
  }
}

export const db = new TillDatabase();

export const getSetting = async <T>(key: string): Promise<T | undefined> =>
  (await db.settings.get(key))?.value as T | undefined;

export const setSetting = (key: string, value: unknown) => db.settings.put({ key, value });
