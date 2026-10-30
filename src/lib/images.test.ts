import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { imageSourceUrl, syncImages } from './images';
import type { Product } from './types';

const product = (id: string, imageUrl: string): Product => ({
  id,
  name: id,
  price: 100,
  category: '未分類',
  code: '',
  imageUrl,
  totalStock: null,
  serverStock: null,
  serverOnSite: null
});

const LH3 = 'https://lh3.googleusercontent.com/d/';
let fetched: string[];

beforeEach(async () => {
  await db.images.clear();
  fetched = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    if (url.includes('private')) return { ok: false, status: 403 } as Response;
    return { ok: true, blob: async () => new Blob(['img:' + url]) } as Response;
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('image sync', () => {
  it('downloads square thumbnails once and skips unchanged ones', async () => {
    const products = [product('A', LH3 + 'aaa'), product('B', LH3 + 'bbb'), product('C', '')];
    expect(await syncImages(products)).toEqual({ downloaded: 2, failed: 0, removed: 0 });
    expect(fetched).toEqual([imageSourceUrl(LH3 + 'aaa'), imageSourceUrl(LH3 + 'bbb')]);
    expect(imageSourceUrl(LH3 + 'aaa')).toBe(LH3 + 'aaa=s400-c');

    fetched = [];
    expect(await syncImages(products)).toEqual({ downloaded: 0, failed: 0, removed: 0 });
    expect(fetched).toEqual([]);
  });

  it('re-downloads changed images and removes ones that are gone', async () => {
    await syncImages([product('A', LH3 + 'aaa'), product('B', LH3 + 'bbb')]);
    fetched = [];
    const res = await syncImages([product('A', LH3 + 'aaa2')]);
    expect(res).toEqual({ downloaded: 1, failed: 0, removed: 1 });
    expect(fetched).toEqual([imageSourceUrl(LH3 + 'aaa2')]);
    expect((await db.images.toArray()).map(i => [i.productId, i.sourceUrl])).toEqual([['A', imageSourceUrl(LH3 + 'aaa2')]]);
  });

  it('drops the stale image when the new one cannot be downloaded', async () => {
    await syncImages([product('A', LH3 + 'aaa')]);
    const res = await syncImages([product('A', LH3 + 'private')]);
    expect(res.failed).toBe(1);
    expect(await db.images.count()).toBe(0);
  });
});
