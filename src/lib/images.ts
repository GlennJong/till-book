import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { Product } from './types';

// 商品圖離線：把 lh3 縮圖下載成 Blob 存進 Dexie（見 spec 7.4）
// lh3 有回傳 CORS 標頭，可以直接 fetch；沒下載到的圖仍走網路，再不行就顯示品名首字

const IMAGE_SIZE = 400;
const CONCURRENCY = 4;

export const imageSourceUrl = (imageUrl: string) => `${imageUrl}=s${IMAGE_SIZE}-c`;

export interface ImageSyncResult {
  downloaded: number;
  failed: number;
  removed: number;
}

let inFlight: Promise<ImageSyncResult> | null = null;

// 只下載網址有變的圖；商品刪除或拿掉圖片連結時一併清掉
export function syncImages(products: Product[]): Promise<ImageSyncResult> {
  inFlight ??= runImageSync(products).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runImageSync(products: Product[]): Promise<ImageSyncResult> {
  const wanted = new Map(products.filter(p => p.imageUrl).map(p => [p.id, imageSourceUrl(p.imageUrl)]));
  const existing = new Map((await db.images.toArray()).map(i => [i.productId, i.sourceUrl]));

  const stale = [...existing.keys()].filter(id => !wanted.has(id));
  await db.images.bulkDelete(stale);

  const queue = [...wanted].filter(([id, url]) => existing.get(id) !== url);
  const result: ImageSyncResult = { downloaded: 0, failed: 0, removed: stale.length };

  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [productId, sourceUrl] = next;
      try {
        const res = await fetch(sourceUrl);
        if (!res.ok) throw new Error(String(res.status));
        await db.images.put({ productId, sourceUrl, blob: await res.blob() });
        result.downloaded++;
      } catch {
        // 圖片沒公開或離線：清掉舊網址的圖，畫面改走網路或顯示字卡
        if (existing.has(productId)) await db.images.delete(productId);
        result.failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return result;
}

// 有本機圖就用本機的 object URL，否則用網路網址
export function useProductImageUrl(productId: string, imageUrl: string) {
  const record = useLiveQuery(() => db.images.get(productId), [productId]);
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!record || record.sourceUrl !== imageSourceUrl(imageUrl)) {
      setLocalUrl(null);
      return;
    }
    const url = URL.createObjectURL(record.blob);
    setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [record, imageUrl]);

  if (!imageUrl) return '';
  return localUrl ?? imageSourceUrl(imageUrl);
}

export const useImageStats = () =>
  useLiveQuery(async () => ({ stored: await db.images.count(), total: await db.products.filter(p => !!p.imageUrl).count() }), []);
