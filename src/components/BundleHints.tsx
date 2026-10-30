import { PackagePlus } from 'lucide-react';
import type { BundleHint } from '../lib/pricing';

// 湊組合提示：固定組合點一下補齊其餘商品；任選組合點一下切到該分類，方便挑剩下的款式
// 文字最多兩行，不列出缺哪些商品（補齊後購物車裡就看得到）
export default function BundleHints(props: {
  hints: BundleHint[];
  onAddProducts: (productIds: string[]) => void;
  onPickCategory: (category: string) => void;
}) {
  if (props.hints.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1.5">
      {props.hints.map(hint => {
        const className = 'flex w-full items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-left text-sm text-sky-900';
        const icon = <PackagePlus className="mt-0.5 size-4 shrink-0" />;
        if (hint.kind === 'fixed') {
          return (
            <li key={hint.bundleName}>
              <button onClick={() => props.onAddProducts(hint.missing)} className={className}>
                {icon}
                <span className="line-clamp-2">
                  加入「{hint.bundleName}」其餘 {hint.missing.length} 件，共 ${hint.bundlePrice}，省 ${hint.saving}
                </span>
              </button>
            </li>
          );
        }
        const text = `再 ${hint.missingCount} 件${hint.category ? `【${hint.category}】` : ''}湊成「${hint.bundleName}」$${hint.bundlePrice}`;
        return (
          <li key={hint.bundleName}>
            {hint.category ? (
              <button onClick={() => props.onPickCategory(hint.category!)} className={className}>
                {icon}
                <span className="line-clamp-2">{text}</span>
              </button>
            ) : (
              <p className={className}>
                {icon}
                <span className="line-clamp-2">{text}</span>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
