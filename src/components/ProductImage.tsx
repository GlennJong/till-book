import { useState } from 'react';
import { useProductImageUrl } from '../lib/images';

// 商品圖：優先用同步到本機的縮圖（離線也看得到），否則用 lh3 網址（=s400-c 由 Google 端縮圖並裁成正方形）
// 沒有圖或載入失敗時顯示品名首字
export default function ProductImage({ productId, name, imageUrl, className = '' }: { productId: string; name: string; imageUrl: string; className?: string }) {
  const src = useProductImageUrl(productId, imageUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return (
      <div className={`flex items-center justify-center bg-stone-200 text-3xl font-bold text-stone-500 ${className}`}>
        {Array.from(name)[0] ?? '?'}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailedSrc(src)}
      className={`object-cover ${className}`}
    />
  );
}
