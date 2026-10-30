import { useState } from 'react';

// 商品圖：lh3 網址加上 =s400-c 由 Google 端縮圖並裁成正方形；沒有圖或載入失敗時顯示品名首字
export default function ProductImage({ name, imageUrl, className = '' }: { name: string; imageUrl: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!imageUrl || failedUrl === imageUrl) {
    return (
      <div className={`flex items-center justify-center bg-stone-200 text-3xl font-bold text-stone-500 ${className}`}>
        {Array.from(name)[0] ?? '?'}
      </div>
    );
  }

  return (
    <img
      src={`${imageUrl}=s400-c`}
      alt={name}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailedUrl(imageUrl)}
      className={`object-cover ${className}`}
    />
  );
}
