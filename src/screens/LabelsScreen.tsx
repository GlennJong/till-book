import { useEffect, useState } from 'react';
import { ArrowLeft, Download, Minus, Plus, Share2 } from 'lucide-react';
import { toDateKey } from '../lib/event';
import { LABELS_PER_PAGE, paginateLabels, renderLabelsPdf, type LabelFormat } from '../lib/labels';
import { useCatalog } from '../lib/useCatalog';

const FORMATS: { value: LabelFormat; label: string; hint: string }[] = [
  { value: 'code128', label: '條碼', hint: '一般掃碼槍都能掃' },
  { value: 'qrcode', label: 'QR code', hint: '相機比較好掃，掃碼槍要是 2D 影像式' }
];

// 條碼標籤：選商品與張數 → 產生 A4 PDF → 下載或分享，再自行列印（白紙剪下或貼紙都可以）
export default function LabelsScreen({ onBack }: { onBack: () => void }) {
  const { products } = useCatalog();
  const printable = products.filter(p => p.code);
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [format, setFormat] = useState<LabelFormat>('code128');
  const [generating, setGenerating] = useState(false);
  const [file, setFile] = useState<{ file: File; url: string } | null>(null);

  const countOf = (id: string) => copies[id] ?? 1;
  const setCount = (id: string, n: number) => {
    setCopies(prev => ({ ...prev, [id]: Math.max(0, n) }));
    setFile(null);
  };
  const total = printable.reduce((sum, p) => sum + countOf(p.id), 0);
  const pageCount = Math.ceil(total / LABELS_PER_PAGE);

  useEffect(() => {
    if (!file) return;
    return () => URL.revokeObjectURL(file.url);
  }, [file]);

  const generate = async () => {
    setGenerating(true);
    try {
      const pages = paginateLabels(printable.map(p => ({ item: { name: p.name, code: p.code }, copies: countOf(p.id) })));
      const blob = await renderLabelsPdf(pages, format);
      const pdf = new File([blob], `till-標籤-${toDateKey(new Date())}.pdf`, { type: 'application/pdf' });
      setFile({ file: pdf, url: URL.createObjectURL(pdf) });
    } catch (err) {
      window.alert(`產生失敗：${err}`);
    } finally {
      setGenerating(false);
    }
  };

  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file.file] });

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 self-start text-stone-600">
        <ArrowLeft className="size-4" /> 返回設定
      </button>

      <section className="rounded-2xl bg-white p-5">
        <h2 className="font-bold">條碼標籤</h2>
        <p className="mt-1 text-sm text-stone-500">
          產生 A4 PDF，每頁 {LABELS_PER_PAGE} 格並印上裁切線。可以印在白紙上剪下，或自行改用 A4 貼紙；也能上傳到超商雲端列印。
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {FORMATS.map(f => (
            <button
              key={f.value}
              onClick={() => {
                setFormat(f.value);
                setFile(null);
              }}
              className={`rounded-xl p-3 text-left ${format === f.value ? 'bg-stone-900 text-white' : 'bg-stone-100'}`}
            >
              <span className="font-medium">{f.label}</span>
              <span className={`block text-xs ${format === f.value ? 'text-stone-300' : 'text-stone-500'}`}>{f.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">張數</h2>
          <div className="flex gap-2 text-sm">
            <button onClick={() => { setCopies(Object.fromEntries(printable.map(p => [p.id, 1]))); setFile(null); }} className="rounded-lg bg-stone-100 px-3 py-1">
              全部 1 張
            </button>
            <button onClick={() => { setCopies(Object.fromEntries(printable.map(p => [p.id, 0]))); setFile(null); }} className="rounded-lg bg-stone-100 px-3 py-1">
              全部清空
            </button>
          </div>
        </div>
        {printable.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">還沒有商品代碼。打開試算表新增商品後按「同步商品資料」，系統會自動編號。</p>
        ) : (
          <ul className="mt-2 divide-y divide-stone-100">
            {printable.map(p => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="font-mono text-sm text-stone-500">{p.code}</p>
                </div>
                <button onClick={() => setCount(p.id, countOf(p.id) - 1)} className="flex size-10 items-center justify-center rounded-lg bg-stone-100" aria-label={`減少 ${p.name}`}>
                  <Minus className="size-4" />
                </button>
                <span className="w-8 text-center font-bold">{countOf(p.id)}</span>
                <button onClick={() => setCount(p.id, countOf(p.id) + 1)} className="flex size-10 items-center justify-center rounded-lg bg-stone-100" aria-label={`增加 ${p.name}`}>
                  <Plus className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {products.length > printable.length && (
          <p className="mt-2 text-xs text-stone-500">有 {products.length - printable.length} 個商品沒有商品代碼，同步後會自動編號。</p>
        )}
      </section>

      {file ? (
        <div className="flex gap-2">
          <a href={file.url} download={file.file.name} className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-stone-900 text-lg font-bold text-white">
            <Download className="size-5" /> 下載 PDF
          </a>
          {canShare && (
            <button onClick={() => navigator.share({ files: [file.file] }).catch(() => {})} className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-stone-100 text-lg font-bold">
              <Share2 className="size-5" /> 分享
            </button>
          )}
        </div>
      ) : (
        <button onClick={generate} disabled={generating || total === 0} className="h-14 rounded-xl bg-stone-900 text-lg font-bold text-white disabled:opacity-40">
          {generating ? '產生中…' : `產生 PDF（${total} 張，${pageCount} 頁）`}
        </button>
      )}
    </div>
  );
}
