// GAS ?action=bootstrap 回傳格式（見 src/backend/till.gs.js）
export interface BootstrapResponse {
  products: {
    id: string;
    name: string;
    price: number;
    category: string;
    imageUrl: string;
    initialStock: number | null;
    currentStock: number | null;
  }[];
  bundles: BundleRecord[];
  promotions: PromotionRecord[];
  warnings: string[];
  serverTime: string;
  scriptVersion?: string; // 1.2.0 起才有；沒有代表腳本過舊
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  imageUrl: string;            // 已由 GAS 轉換為 lh3 網址
  initialStock: number | null; // null = 不追蹤庫存
  serverStock: number | null;  // 最近一次從伺服器取得的目前庫存
}

// 組合價、滿額活動以試算表原始內容保存，計價時再對應到商品（Phase 2）
export interface BundleRecord {
  name: string;
  bundlePrice: number;
  pickCount: number | null;
  items: string[]; // 品名或「【分類】xxx」
}

export interface PromotionRecord {
  name: string;
  threshold: number;
  discountAmount: number;
  gifts: string[];  // 贈品品名，同一款出現兩次代表送 2 個
}

export type LineType = '商品' | '贈品' | '折扣';

export interface OrderLine {
  lineType: LineType;
  productId: string; // 折扣列為 ''
  itemName: string;
  quantity: number;
  listPrice: number;
  unitPrice: number;
  subtotal: number;
  description: string;
}

export interface OutboxOrder {
  orderNo: string; // YYMMDD-HHmmss-XXXX
  createdAt: string;
  seq: number; // 建立順序，同步時依此排序
  revertOf?: string;
  status: 'PENDING' | 'SYNCING' | 'SYNCED';
  retryCount: number;
  nextRetryAt: number;
  paymentMethod: string;
  note: string;
  lines: OrderLine[];
  finalTotal: number;
}
