// 條碼標籤 PDF（見 spec 8.1）：A4 白紙、格子之間印裁切線，每格是條碼 + 品名 + 商品代碼
// 每頁先用 canvas 以 300dpi 畫好再放進 PDF：品名由瀏覽器字型繪製，PDF 不需要內嵌中文字型
// bwip-js、jsPDF 只在產生時才載入，不影響收銀畫面

export type LabelFormat = 'code128' | 'qrcode';

export interface LabelItem {
  name: string;
  code: string;
}

const PAGE_MM = { width: 210, height: 297 };
const MARGIN_MM = 10;
const COLS = 3;
const ROWS = 8;
const PADDING_MM = 2.5;
const DPI = 300;
const PX_PER_MM = DPI / 25.4;

export const LABELS_PER_PAGE = COLS * ROWS;
export const CELL_MM = {
  width: (PAGE_MM.width - MARGIN_MM * 2) / COLS,
  height: (PAGE_MM.height - MARGIN_MM * 2) / ROWS
};

// 依張數展開成標籤清單，再切成每頁一組
export function paginateLabels(items: { item: LabelItem; copies: number }[]): LabelItem[][] {
  const labels = items.flatMap(({ item, copies }) => Array.from({ length: Math.max(0, copies) }, () => item));
  const pages: LabelItem[][] = [];
  for (let i = 0; i < labels.length; i += LABELS_PER_PAGE) pages.push(labels.slice(i, i + LABELS_PER_PAGE));
  return pages;
}

// 第 index 格的左上角（mm），由左到右、由上到下
export const cellOrigin = (index: number) => ({
  x: MARGIN_MM + (index % COLS) * CELL_MM.width,
  y: MARGIN_MM + Math.floor(index / COLS) * CELL_MM.height
});

const px = (mm: number) => Math.round(mm * PX_PER_MM);

type Bwip = typeof import('bwip-js/browser');

function drawCutLines(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.strokeStyle = '#bbbbbb';
  ctx.lineWidth = 2;
  ctx.setLineDash([px(1.5), px(1.5)]);
  for (let c = 0; c <= COLS; c++) {
    const x = px(MARGIN_MM + c * CELL_MM.width);
    ctx.beginPath();
    ctx.moveTo(x, px(MARGIN_MM));
    ctx.lineTo(x, px(PAGE_MM.height - MARGIN_MM));
    ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = px(MARGIN_MM + r * CELL_MM.height);
    ctx.beginPath();
    ctx.moveTo(px(MARGIN_MM), y);
    ctx.lineTo(px(PAGE_MM.width - MARGIN_MM), y);
    ctx.stroke();
  }
  ctx.restore();
}

// 文字超出寬度時加上省略號
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > maxWidth) chars.pop();
  return chars.join('') + '…';
}

function drawLabel(ctx: CanvasRenderingContext2D, bwip: Bwip, label: LabelItem, index: number, format: LabelFormat) {
  const origin = cellOrigin(index);
  const left = px(origin.x + PADDING_MM);
  const top = px(origin.y + PADDING_MM);
  const width = px(CELL_MM.width - PADDING_MM * 2);
  const centerX = left + width / 2;

  // 條碼區高度：Code128 扁長、QR 正方形；剩下的空間放品名與代碼
  const symbolHeight = px(format === 'qrcode' ? 19 : 15);
  const symbol = document.createElement('canvas');
  bwip.toCanvas(symbol, format === 'qrcode' ? { bcid: 'qrcode', text: label.code, scale: 6 } : { bcid: 'code128', text: label.code, scale: 4, height: 15 });
  const ratio = Math.min(width / symbol.width, symbolHeight / symbol.height);
  const w = symbol.width * ratio;
  const h = symbol.height * ratio;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(symbol, centerX - w / 2, top + (symbolHeight - h) / 2, w, h);

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${px(3)}px sans-serif`;
  ctx.fillText(fitText(ctx, label.name, width), centerX, top + symbolHeight + px(1));
  ctx.font = `${px(2.6)}px ui-monospace, monospace`;
  ctx.fillText(label.code, centerX, top + symbolHeight + px(4.6));
}

export async function renderLabelsPdf(pages: LabelItem[][], format: LabelFormat): Promise<Blob> {
  const [bwip, { jsPDF }] = await Promise.all([import('bwip-js/browser'), import('jspdf')]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  pages.forEach((labels, pageIndex) => {
    const canvas = document.createElement('canvas');
    canvas.width = px(PAGE_MM.width);
    canvas.height = px(PAGE_MM.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawCutLines(ctx);
    labels.forEach((label, i) => drawLabel(ctx, bwip, label, i, format));

    if (pageIndex > 0) pdf.addPage('a4', 'portrait');
    pdf.addImage(canvas, 'PNG', 0, 0, PAGE_MM.width, PAGE_MM.height, undefined, 'FAST');
  });

  return pdf.output('blob');
}
