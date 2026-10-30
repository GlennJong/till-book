# Till：市集極簡 Local-First 收銀 App 開發規範

> 專案代號 **Till**（英文「收銀機、錢櫃」）。Drive 檔名前綴 `till-`，PWA 名稱 `Till`。

## 1. 專案願景與架構哲學

這是給文創市集、同人誌展售會用的極輕量收銀 PWA。系統遵循 **Local-First（本地優先）** 原則：

* **零依賴連線**：點單、計價、扣庫存、找零全部在前端裝置本機完成，不等網路。
* **無獨立 Web 後台**：使用者的 Google Sheets 就是唯一的 CMS 和雲端資料庫。Sheet 是給「人」看的後台，欄位以可讀性為優先（例如組合規則用品名而不用 ID）。
* **資料純追加（Append-Only）**：交易只會新增或反向沖銷（Revert），絕不對「銷售紀錄」既有列做原地更新或刪除。
* **使用情境由使用者自訂**：系統不內建「場次 / 活動」概念。要一場展一份表，還是全部共用一份表，由使用者自己決定。
* **後端優先**：能交給 Google Sheets 機制（公式、資料驗證、觸發器）或 GAS 處理的就交給後端，後端做不到的才由前端補。

---

## 2. 技術棧選型

| 領域 | 技術與套件 | 職責與選型理由 |
| --- | --- | --- |
| **框架 & 建構** | React 19 + TypeScript + Vite | 與 money-book 一致 |
| **樣式系統** | Tailwind CSS + Lucide React（暫定，UI 邊做邊討論） | 高對比觸控按鈕 |
| **PWA 支援** | `vite-plugin-pwa`（`registerType: 'autoUpdate'`） | 離線 Service Worker（App shell） |
| **本地資料庫** | `dexie` (IndexedDB Wrapper) | outbox、快取的主檔資料、商品圖 Blob、交易安全 |
| **建表 / 授權** | `@glennjong/vibe-sheets`（擴充版，見第 3 章） | 沿用 money-book 的 `useGoogleAuth` + `useSheetManager` 流程 |
| **雲端後端** | Google Sheets + Google Apps Script Web App | 自訂路由：聚合讀取、冪等批次寫入 |

### 2.1 參考 money-book 的沿用 / 差異

| money-book | Till |
| --- | --- |
| `SetupScreen` → `useGoogleAuth` 登入、檢查 Apps Script API | 直接沿用 |
| `SheetSelector` 以 prefix 列出檔案，選定後把 `scriptUrl` 存進 localStorage | 沿用，prefix 改為 `till-` |
| Web App 部署為 `ANYONE_ANONYMOUS` + `USER_DEPLOYING` | 沿用。**收銀時完全不需要 Google Token**，Token 只在建表、選檔、升級腳本時使用 |
| `fetch` POST 時不設 Content-Type（瀏覽器會當 text/plain 送出，不觸發 CORS preflight） | **必須保留**這個寫法 |
| localStorage pending queue + add / edit / delete | 改用 Dexie outbox，動作只剩 append（ORDER / REVERT） |

---

## 3. vibe-sheets 擴充規格

vibe-sheets 目前的限制：只能建一個分頁、欄位固定、GAS 程式碼寫死、沒有 Lock 和冪等機制。以下擴充**向下相容**：原本的 CRUD 全數保留，`tabName` / `columns` 參數照常可用。

### 3.1 `createSheet` 新參數

```typescript
interface ColumnDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean';
  // 寫在標題列的 ARRAYFORMULA，實際寫入為 ={"<name>"; <arrayFormula>}
  arrayFormula?: string;
  validation?:
    | { kind: 'listFromRange'; range: string; strict?: boolean } // strict=false：允許非法值但標紅角
    | { kind: 'list'; values: string[]; strict?: boolean }
    | { kind: 'checkbox' };
  note?: string;      // 標題儲存格的註解，給使用者看的欄位說明
  readonly?: boolean; // 灰底 + 警告式保護（使用者修改時會跳警告，但不會被擋）
}

interface TabDefinition {
  name: string;
  columns: ColumnDefinition[];
  hidden?: boolean;                   // 隱藏分頁（例如下拉選單的輔助分頁）
  systemColumns?: boolean;            // 預設 true：加上 is_enabled / id / created_at / updated_at
  demoRows?: Record<string, unknown>[]; // 預設 []；舊版單分頁模式維持原本的 demo row
  frozenRows?: number;                // 預設 1
}

createSheet(options: {
  sheetName: string;
  prefix?: string;
  tabName?: string;                 // 舊參數，等同 tabs: [{ name: tabName, columns }]
  columns?: ColumnDefinition[];     // 舊參數
  tabs?: TabDefinition[];           // 新參數：多分頁
  script?: {
    code: string;                   // 開發者自訂 GAS，接在基礎 CRUD 程式碼之後
    version?: string;               // 寫進檔案 description 的 metadata，用來判斷是否需要升級
    oauthScopes?: string[];         // 會與預設的 spreadsheets.currentonly 合併
  };
  setupRequests?: (ctx: SetupContext) => object[]; // 逃生口：原生 Sheets batchUpdate requests（例如條件式格式）
});
```

* **範圍佔位符**：`arrayFormula` 和 `validation.range` 裡的 `{{Tab.column}}` 會被替換成 `Tab!X2:X`，`{{.column}}` 代表同一分頁。這樣開發者不用自己算欄位字母，系統欄位插入後也不會錯位。
* 建表透過 Sheets API 完成（App 自己建的檔案在 `drive.file` scope 內就能 batchUpdate），**不需要擴大 OAuth scope**。

### 3.2 GAS 擴充：自訂路由

沿用現有的 `var action = e.parameter.method || e.parameter.action;` 命名，不改參數名，只在進入 CRUD 前多比對一次自訂路由：

```javascript
// 基礎 doPost（doGet 同理，查 VIBE_ROUTES.GET）
var action = e.parameter.method || e.parameter.action;
var RESERVED = ['PUT', 'UPDATE', 'DELETE'];
if (action && RESERVED.indexOf(action) === -1
    && typeof VIBE_ROUTES !== 'undefined' && VIBE_ROUTES.POST && VIBE_ROUTES.POST[action]) {
  return createJsonResponse(VIBE_ROUTES.POST[action](e));
}
// 以下為原本的 CRUD：PUT/UPDATE → 更新、DELETE → 軟刪除、其餘 → 新增
```

* 開發者在 `script.code` 裡定義 `var VIBE_ROUTES = { GET: {...}, POST: {...} }`。觸發器同樣用 hook 擴充（例如 `VIBE_ON_EDIT`，見 4.1）。
* `PUT` / `UPDATE` / `DELETE` 是保留字，自訂路由不能覆蓋。
* 沒有對應到自訂路由的 action，行為和現在完全一樣（POST 會落到新增），所以既有 App 不受影響。

### 3.3 腳本升級（新增 API）

`upgradeScript(token, file, script)`：更新腳本內容 → 建立新 version → **更新既有 deployment**（`deployments.update`）。這樣 `scriptUrl` 不變，已經存在使用者裝置上的網址也不會失效。前端比對檔案 description 裡的 `scriptVersion`，版本落後時提示使用者升級。

### 3.4 授權提醒

和現行版本一樣，建立完成後擁有者必須用瀏覽器開啟一次 `scriptUrl` 完成授權，否則匿名存取會回 403。Setup 流程要明確引導這一步。

---

## 4. Google Sheets 資料表規格（Schema）

### 4.0 欄位設計原則

1. **使用者只需要填自己看得懂的欄位**。業務欄位一律用白話中文標題，不用抽象概念（沒有 priority、type 這類欄位）。GAS 讀取時把中文標題對應成英文 key，前端程式不受影響。
2. **系統欄位沿用 vibe-sheets 標準**（`is_enabled` 在最左，`id / created_at / updated_at` 在最右），保持英文名稱，讓 vibe-sheets 的基礎 CRUD 照常運作：
   * `is_enabled`：使用者唯一會碰的系統欄位，是一個勾選框（標題註解寫「勾選 = 啟用」）。
   * `id / created_at / updated_at`：灰底、唯讀警告、標題註解寫「系統自動填入」。**使用者永遠不用手填。**
3. **選填欄位留白就有合理預設**（見各表「留白時」欄）。
4. **使用者可以自由新增欄位**（例如「備註」「成本」）或調整欄位順序：系統一律以標題名稱讀取，不認得的欄位直接忽略。公式在建表時寫入，搬移欄位時 Sheets 會自動修正參照。
5. `商品`、`組合價`、`滿額活動` 啟用系統欄位；`銷售紀錄` 由系統寫入、`銷量統計` 由公式產生，都不需要系統欄位（`systemColumns: false`）。

試算表共 5 張使用者可見的分頁，加上 1 張隱藏的輔助分頁。

### 4.1 系統欄位自動填入（vibe-sheets 內建 `onEdit`）

Google Sheets 的公式做不到「填入當下時間後就固定不變」（`NOW()` 每次重算都會變），所以用 **Apps Script 的 simple trigger `onEdit(e)`**。腳本綁定在試算表上，不需要另外安裝或授權。

這是通用需求，所以**做在 vibe-sheets 的基礎腳本裡**，所有用 vibe-sheets 建的表都能受益（包括 money-book 使用者手動編輯 Sheet 的情境）：

| 時機 | 行為 |
| --- | --- |
| 使用者編輯某一列（含貼上多列），且該分頁有系統欄位 | `id` 為空（代表新的一列）→ 填入 UUID、`created_at`，並勾選 `is_enabled`（勾選框沒勾時的值是 FALSE 而不是空白，所以要用 `id` 是否為空來判斷新列）；每次編輯 → `updated_at` 更新為現在時間 |
| 只編輯 `id` / `created_at` / `updated_at` 本身 | 忽略（尊重使用者手動修正）。切換 `is_enabled` 會更新 `updated_at` |
| 整列都是空白（例如清空一列），或編輯的是標題列 | 忽略 |

* 開發者的自訂邏輯用 hook 擴充，不要自己定義 `onEdit`（同一個專案只能有一個 `onEdit`，後定義的會蓋掉前面的）：

```javascript
// vibe-sheets 基礎腳本
function onEdit(e) {
  vibeFillSystemColumns(e);
  if (typeof VIBE_ON_EDIT === 'function') VIBE_ON_EDIT(e);
}
```

* **已知限制**：`onEdit` 不會在 API 寫入、刪除列、排序時觸發。API 寫入本來就會由 CRUD 補欄位；另外 Till 的 `bootstrap` 讀取時，遇到缺 `id` 的列也會在 Lock 內補上，作為雙重保險。

### 4.2 Google Sheets 透過 API 能做到的設計（Sheets API `batchUpdate`）

| 效果 | 做得到？ | 本專案用在 |
| --- | --- | --- |
| 下拉選單：來源是另一個範圍（`ONE_OF_RANGE`），新增商品後選項會自動更新 | ✅ | 組合價的品項、滿額活動的贈品 |
| 下拉選單：固定選項（`ONE_OF_LIST`） | ✅ | — |
| 輸入的值不在選項內時，標紅色角標警告但不擋（`strict: false`） | ✅ | 商品改名後，提醒去修組合 |
| 勾選框（`BOOLEAN`） | ✅ | `is_enabled` |
| 條件式格式（自訂公式） | ✅ | 品名、商品代碼重複時標紅 |
| 欄位設為純文字格式 | ✅ | 單號、商品編號、商品代碼（避免被轉成數字、吃掉開頭的 0 或變成科學記號） |
| 欄位底色、凍結標題列、標題註解 | ✅ | 系統欄位灰底、欄位說明 |
| 保護範圍（警告模式：改的時候跳提示） | ✅ | 系統欄位、公式欄 |
| 隱藏分頁 | ✅ | `_選單` 輔助分頁 |
| 下拉選單**同時**來自兩個範圍 | ❌ | → 用隱藏分頁先把兩個範圍合併成一欄，下拉選單再指向它 |
| 連動式下拉（依別格的值切換選項） | ❌（要另外寫公式輔助） | 本專案不需要 |

### 工作表 1：`商品`

| 欄位 | 必填 | 留白時 | 說明 |
| --- | --- | --- | --- |
| `is_enabled` | | 自動勾選 | 取消勾選就是下架，收銀畫面會看不到。商品有銷售紀錄後請用下架，不要刪除 |
| 品名 | ✅ | — | **不可重複**（重複時整格標紅） |
| 售價 | ✅ | — | |
| 分類 | | 歸到「未分類」 | 前端用來切分類 Tab，也可以在組合價裡整類任選 |
| 商品代碼 | | **系統自動編號**（1001 起） | 純數字，印在條碼標籤上、掃碼時用來找商品；可自行修改，**不可重複**（重複時標紅）。改了要重印標籤（見 8.1） |
| 圖片連結 | | 顯示品名首字字卡 | 直接貼上 Google Drive 分享連結 |
| 總進貨量 | | **不追蹤庫存**（永不顯示 SOLD OUT） | 手上全部的貨（**總庫存**，跨場次共用）。補貨或再刷時直接把數字加上去 |
| 目前庫存 | 🔒 公式 | — | 灰底，`= 總進貨量 − 所有已售出數量（含贈出）`，可以是負值（代表超賣或欠貨） |
| 現場數量 | | 不追蹤現場 | 選填。這次帶到現場的件數；**有值時，每次成交由系統直接扣減，沖銷時加回**（見 4.3） |
| 備註 | | — | 給人看的記事（例如「10/5 再刷 50 本」），系統不讀取 |
| `id` / `created_at` / `updated_at` | 🔒 自動 | — | 見 4.1 |

* 庫存用 `id` 對應銷售紀錄來計算，所以商品改名後，庫存和歷史紀錄都不會斷掉。
* 一本帳本跨所有場次使用，商品只建一次，賣不完下一場繼續賣。
* 「目前庫存」公式（寫在標題列）：

```
={"目前庫存"; ARRAYFORMULA(IF(({{.id}}="")+({{.總進貨量}}=""), "", {{.總進貨量}} - SUMIF({{銷售紀錄.商品編號}}, {{.id}}, {{銷售紀錄.數量}})))}
```

（GAS 讀取時仍相容舊標題「備貨數量」，舊帳本不會直接壞掉，但不會自動改欄位。）

### 工作表 2：`組合價`

| 欄位 | 必填 | 留白時 | 說明 |
| --- | --- | --- | --- |
| `is_enabled` | | 自動勾選 | 取消勾選就是暫停這個組合 |
| 組合名稱 | ✅ | — | 例如「A+B 套組」「本子任選 3 本」 |
| 組合價 | ✅ | — | |
| 任選件數 | | **品項全部都要**（固定組合） | 填 N 代表從下列品項中任選 N 件 |
| 品項 1 … 品項 8 | ✅ 至少一格 | — | 從下拉選單選**商品**或**整個分類** |
| `id` / `created_at` / `updated_at` | 🔒 自動 | — | 見 4.1 |

**品項的下拉選單**長這樣（分類會加上前綴，跟品名分開，不會撞名）：

```
▾ 吊飾甲
  吊飾乙
  本子 A
  本子 B
  【分類】吊飾
  【分類】本子
```

* 做法：隱藏分頁 `_選單` 只有一欄公式，把「所有品名」和「所有分類加上【分類】前綴」合併、去重、排序。品項欄的下拉選單指向這一欄。新增商品或分類後，選項會自動出現。
* 驗證設 `strict: false`：商品改名後，舊名稱會出現紅色角標，提醒使用者修正。
* 前端遇到對不到的品項時，該組合**自動停用**，並在同步結果中警告。

填法範例：

| 組合名稱 | 組合價 | 任選件數 | 品項 1 | 品項 2 | 品項 3 |
| --- | --- | --- | --- | --- | --- |
| A+B 套組 | 250 | | A | B | |
| 同款兩件 | 180 | | 吊飾甲 | 吊飾甲 | |
| 本子任選 3 本 | 300 | 3 | 【分類】本子 | | |
| 吊飾任選 2 | 180 | 2 | 吊飾甲 | 吊飾乙 | 吊飾丙 |

* 套用規則不需要使用者設定：**系統自動找出對客人最便宜的套法**（見 6.1）。
* 不支援「任選 N 件打 X 折」這類百分比折扣。

### 工作表 3：`滿額活動`

| 欄位 | 必填 | 留白時 | 說明 |
| --- | --- | --- | --- |
| `is_enabled` | | 自動勾選 | 取消勾選就是暫停這個活動 |
| 活動名稱 | ✅ | — | 收銀畫面會顯示給你看，例如「滿 500 送貼紙」 |
| 滿額門檻 | ✅ | — | |
| 折抵金額 | 擇一 | 不折抵 | 滿額折；可以和贈品一起填 |
| 贈品 1 … 贈品 4 | 擇一 | 不送 | 下拉選單：商品品名。同一款送 2 個就填兩格；使用者自行加「贈品 5」也會讀到 |
| `id` / `created_at` / `updated_at` | 🔒 自動 | — | 見 4.1 |

**一律階梯式**：達標時只給「達到的最高門檻」那一階；同一個門檻的多列會一起給。想同時送多樣東西，就填在同一列的多個贈品欄。

| 活動名稱 | 滿額門檻 | 折抵金額 | 贈品 1 | 贈品 2 |
| --- | --- | --- | --- | --- |
| 滿 500 送貼紙＋明信片 | 500 | | 貼紙 | 明信片 |
| 滿 1000 送海報＋貼紙、折 50 | 1000 | 50 | 海報 | 貼紙 |

買 600 元 → 貼紙＋明信片；買 1200 元 → 海報＋貼紙、折 50（不再送明信片）。

### 工作表 4：`銷售紀錄`（系統寫入，使用者只看不改）

| 欄位 | 說明 |
| --- | --- |
| 時間 | 交易時間（GAS 以 `new Date(iso)` 寫入，Sheet 會顯示當地時間） |
| 單號 | 人看得懂的單號：`YYMMDD-HHmmss-XXXX`（XXXX 為每張單隨機產生的 4 碼，避免同一秒內或跨裝置撞號），同時是冪等鍵 |
| 類型 | `商品` / `贈品` / `折扣` |
| 品名 | 寫入當下的品名（快照）；折扣列寫折扣名稱 |
| 數量 | 沖銷時為負 |
| 定價 | 寫入當下的售價（快照） |
| 成交單價 | 實際成交價：手動改價時是改過的價格；贈品為 0；折扣列為負的折抵額 |
| 小計 | 數量 × 成交單價 |
| 付款方式 | 純文字，例如「現金」「LINE Pay」 |
| 場次 | 下單當下 App 設定的場次名稱（純文字標籤）；沒設定場次時留空。沖銷沿用原單的場次 |
| 說明 | 價格怎麼來的：`手動改價` / `整單改價` / `組合：本子任選 3 本` / `活動：滿 500 送貼紙`；一般商品留空 |
| 備註 | 收銀員備註（例如預購的寄送資訊） |
| 沖銷單號 | 這列是沖銷時，填被沖銷的原單號 |
| 商品編號 | 🔒 系統用，灰底 |

**記帳不變式**：同一個單號的小計加總 = 該單實收金額；整張表的小計加總 = 總營收（已扣除沖銷）。

### 工作表 5：`銷量統計`（公式產生，使用者只看不改）

讓直接打開 Sheet 的人，不必自己從銷售紀錄回推就能看懂各場次的銷量。整張表由公式即時計算（沖銷、補送都會自動正確），保護為警告模式，只有場次下拉格可以改。

```
場次：[ CWT70 ▾ ]          ← 下拉：「全部」+「未指定場次」+ 銷售紀錄出現過的場次（最近開始的在前）

商品金額  12,800   折扣  −460   實收  12,340
售出 87 件            贈出 12 件

品名      售出   贈出   商品金額
本子 A     32      0     6,400
吊飾        0      0         0     ← 沒賣出的也列出來
貼紙        3     12        90
```

* 列出商品表的**所有商品**（順序同商品表，用 `id` 對應銷售紀錄，商品改名不會斷），沒賣出的顯示 0。
* **售出**：類型 `商品` 的數量；**贈出**：類型 `贈品` 的數量（不算進售出和金額，但會扣庫存）。
* **商品金額**：類型 `商品` 的小計。組合價、滿額折、整單改價是整單折扣，無法拆到單一商品，所以統一列在上方的「折扣」，「實收」= 商品金額 + 折扣 = 該場次小計加總。
* 下拉選單是共用的：多人同時開著 Sheet 時，一人切換場次，其他人的畫面也會跟著變（Google Sheet 本身的行為，接受）。
* 不做跨場次比較矩陣（目前不需要）。

### 4.3 場次與現場數量

**場次是銷售紀錄上的文字標籤，不是獨立的表。** 完全選填，不設定場次也能正常收銀（統計時歸到「未指定場次」）。

* **在 App 設定**：場次名稱 + 結束時間（預設今天 23:59，跨天的場次選結束那天）。設定存在裝置本機。
* **自動過期**：過了結束時間，新訂單就不再帶場次，App 提示「CWT70 已結束，要開始新場次嗎？」。
* **自動完成**：`bootstrap` 回傳最近用過的場次名稱（依最後銷售時間排序），別台裝置或隔天登入時點選即可接續，避免打錯字把同一場拆成兩個名字。
* 一天跑兩場：結束一場、設定下一場即可，沒有日期重疊的問題。
* 各裝置各自設定場次；訂單頁顯示每筆的場次，選錯時用沖銷再重開。

**現場數量與場次無關**，代表「此刻攤位上還有幾件」：

| 事件 | 目前庫存（公式） | 現場數量（有值時） |
| --- | --- | --- |
| 成交（含贈品） | 減少 | GAS 寫入銷售紀錄時，在同一個 Lock 內直接扣減 |
| 沖銷 | 加回 | GAS 直接加回 |
| 場次結束 | 不變 | 不變；使用者自己決定要不要清空（清空不影響任何計算） |
| 重送的單號（duplicate） | 不變 | 跳過，不會重複扣 |

* 使用者可以隨時在 Sheet 上直接修改現場數量（例如盤點、從車上補貨）。**請在 App 顯示「待同步 0 筆」時再改**，否則還沒送出的單同步後會再扣一次（寫在欄位註解）。
* 扣到負數照樣記錄（代表超賣或點錯貨），App 顯示警告。
* 留白就不扣；不追蹤現場的人完全不用碰這欄。

---

## 5. 前端資料結構與 TypeScript 定義

GAS 會把中文標題對應成下列英文 key 再回傳給前端。

```typescript
export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;             // 留白時為 '未分類'
  imageUrl: string;             // 已由 GAS 轉換為 lh3 網址
  code: string;                 // 商品代碼（條碼內容）
  totalStock: number | null;    // 總進貨量；null = 不追蹤庫存
  serverStock: number | null;   // 最近一次從伺服器取得的目前庫存
  serverOnSite: number | null;  // 最近一次從伺服器取得的現場數量；null = 不追蹤現場
}

export interface BundleRule {
  name: string;
  bundlePrice: number;
  rawItems: string[];           // 試算表原始內容（品名或「【分類】xxx」，含重複）
  isValid: boolean;             // 有品項對不到時為 false
  kind:
    | { type: 'FIXED'; requirement: Map<string, number> }      // 任選件數留白：productId → 需要件數
    | { type: 'PICK'; pickCount: number; pool: Set<string> };   // 任選件數 = N：分類展開後的 productId 集合
}

export interface PromotionRule {
  name: string;
  threshold: number;
  discountAmount: number;       // 0 = 不折抵
  gifts: { productId: string; quantity: number }[]; // 贈品 1…N，重複品名合併為數量
}

export type LineType = '商品' | '贈品' | '折扣';

export interface OrderLine {
  lineType: LineType;
  productId: string;            // 折扣列為 ''
  itemName: string;
  quantity: number;
  listPrice: number;
  unitPrice: number;
  subtotal: number;
  description: string;          // 對應「說明」欄
}

// 本地交易佇列實體 (IndexedDB Outbox)
export interface OutboxOrder {
  orderNo: string;              // YYMMDD-HHmmss-XXXX
  createdAt: string;            // ISO 8601
  revertOf?: string;            // 有值代表這是一筆沖銷
  status: 'PENDING' | 'SYNCING' | 'SYNCED';
  retryCount: number;
  nextRetryAt: number;          // 指數退避用
  paymentMethod: string;        // 自由文字
  event: string;                // 下單當下的場次名稱；'' = 未指定。沖銷沿用原單
  note: string;
  lines: OrderLine[];
  finalTotal: number;           // = Σ lines.subtotal
}

export interface Settings {
  paymentMethods: string[];     // 預設 ['現金', 'LINE Pay', '轉帳']，可以自由增刪
  stockRefreshMode: 'AFTER_SYNC' | 'INTERVAL' | 'MANUAL';
  stockRefreshIntervalMin: number;
  currentEvent: { name: string; endsAt: string } | null; // 目前場次；過了 endsAt 視為 null
}
```

Dexie tables：`products`, `bundles`, `promotions`, `outbox`, `settings`, `images`（`{ productId, sourceUrl, blob }`）。

---

## 6. 核心演算法與狀態機

### 6.1 計價管線（Pricing Pipeline）

購物車每次異動，前端依序執行。**全部規則自動對客人取最優，使用者不需要設定任何優先順序。**

```
[購物車品項]（每個品項都可以手動改價；改過就以手動價格為準）
       │
       ▼
【階段一：組合價最佳化】
 1. 只拿「沒有手動改價」的品項，建立 productId → 件數 Map。
 2. 只取 isValid 的組合規則。
 3. 窮舉搜尋，找出客人總價最低的套法（也可以一個都不套）：
    - 固定組合：剩餘件數完全滿足 requirement 才能套用。
    - 任選組合：剩餘品項中屬於 pool 的件數 ≥ pickCount 才能套用，
                取 pool 中定價最高的 pickCount 件進組合（對客人最有利）。
    - 只有在「進組合品項的原價總和 > 組合價」時才算可以套用。
    - 用「剩餘件數」當 memo key。市集單據通常 < 20 件，窮舉沒有效能問題。
    - 安全閥：搜尋節點超過 5,000 時，改用「每次套用折抵最多的組合」的貪婪法。
 4. 每套用一次，產生一個折扣列（金額 = 原價總和 − 組合價，說明 = 組合：<名稱>）。
 5. 輸出：Subtotal = Σ 商品成交價 − Σ 組合折抵。
       │
       ▼
【階段二：滿額活動】
 1. 篩出 threshold ≤ Subtotal 的活動。
 2. 一律階梯式：只套用「達到的最高門檻」那一階；同門檻的多列一起套用。
 3. 滿額折 → 折扣列（說明 = 活動：<名稱>）；滿額贈 → 贈品列（成交單價 0，照常扣庫存，庫存不足也照送）。
 4. 門檻一律跟 Subtotal 比較。
       │
       ▼
【階段三：整單改價（選用）】
 例如「算你 300 就好」→ 折扣列，金額 = 300 − 目前總額，說明 = 整單改價。
       │
       ▼
 FinalTotal = Σ lines.subtotal（下限為 0）
```

### 6.2 沖銷（Revert，類似 `git revert`）

* 只能**整單沖銷**：產生一筆新的 OutboxOrder，`revertOf = 原單號`，`lines` 是原單所有列（商品 / 贈品 / 折扣）的數量和小計全部取負。庫存、營收會自動回補。
* 部分退貨 = 先整單沖銷，再把客人保留的品項重新結一次帳（就像 revert 之後再 commit）。重結時計價管線會重新判定組合和贈品，自然解決「退了一件後贈品條件不成立」的問題。
* 沖銷單不能再被沖銷，同一筆原單也不能沖銷兩次（前端擋一次，GAS 再擋一次）。
* 原單還在 PENDING 也一樣走沖銷：outbox 依 FIFO 送出，原單一定先寫入，保留完整稽核軌跡。

### 6.3 同步狀態機（Outbox）

```
[結帳] → Dexie transaction：寫入 outbox (PENDING) → 畫面清空（毫秒級）
       │
       ▼
[Sync Engine]（觸發時機：結帳後、online 事件、退避計時到期）
 1. 取出所有 PENDING 且 nextRetryAt ≤ now 的單據，依 createdAt 排序，標記為 SYNCING。
 2. 一次 POST 整批單據到 ?action=orders（弱網路下減少請求次數）。
 3. 成功：回傳每筆單據的結果（written / duplicate 都視為成功）→ 標記 SYNCED；
          若 stockRefreshMode = AFTER_SYNC，同時用回應中的 stock 更新 serverStock。
 4. 失敗 / Timeout：恢復為 PENDING，retryCount++，nextRetryAt = now + min(2^n × 5s, 5min)。
```

### 6.4 可用庫存與冷啟動自我修復

```
AvailableStock(p) = serverStock(p) − Σ quantity(p)，加總範圍是所有「非 SYNCED」的 outbox 行
```

* serverStock 只包含已經寫入 Sheet 的交易，而這個公式只扣還沒寫入的交易，所以**任何時候**都可以安全覆蓋 serverStock，不必等 PENDING 清空。
* 冷啟動時，先把所有 SYNCING **無條件重設為 PENDING**。最壞情況是「已寫入但沒收到回應」的單據被重送：GAS 端冪等防護會回 duplicate，庫存只會短暫少算，下次同步後就修正。
* **多裝置**：GAS 做不到即時同步，這點已知並接受。由使用者自選庫存刷新模式：
  * `AFTER_SYNC`：每次寫入成功，順便從回應中取得最新庫存（不多發請求）
  * `INTERVAL`：每 N 分鐘呼叫一次 bootstrap
  * `MANUAL`：手動按刷新
* 現場數量採同樣的算法：`AvailableOnSite(p) = serverOnSite(p) − Σ 非 SYNCED 的 quantity(p)`。
* **SOLD OUT 判斷**：商品有現場數量時看 AvailableOnSite，沒有時看 AvailableStock。
* 庫存 ≤ 0 時，商品按鈕顯示 SOLD OUT，但**仍然可以點**。點下去會跳確認「庫存不足，仍要賣出？」（適用預購、展後寄送），確認後照常加入購物車，庫存可以扣成負值。

---

## 7. GAS 自訂腳本規格（`script.code`）

### 7.1 `GET ?action=bootstrap`：聚合快讀

一次回傳 `{ products, bundles, promotions, recentEvents, serverTime }`：

* `recentEvents`：銷售紀錄中最近出現過的場次名稱（去重，依最後銷售時間排序，取前 10 個），供 App 自動完成。

* 以 `HEADER_MAP`（中文標題 → 英文 key）讀取，不認得的欄位忽略。
* 只回傳 `is_enabled` 為 TRUE 的列；遇到缺 `id` 的列，在 Lock 內補上系統欄位（見 4.1）。
* 「圖片連結」經過 `toLh3Url()` 轉換。
* 組合價的「品項 1…8」收斂成陣列 `rawItems: string[]`，過濾掉空值。分類展開和品名對應交給前端處理。

```javascript
function toLh3Url(url) {
  var match = String(url || '').match(/[-\w]{25,}/);
  return match ? 'https://lh3.googleusercontent.com/d/' + match[0] : '';
}
```

### 7.2 `POST ?action=orders`：冪等批次寫入

```javascript
function postOrders(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: 'LOCK_TIMEOUT' };
  try {
    var payload = JSON.parse(e.postData.contents); // { orders: OutboxOrder[] }
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('銷售紀錄');
    var col = headerIndexMap(sheet);               // 欄位位置一律以標題名稱查詢，不寫死欄位字母
    var results = [];
    var rows = [];

    payload.orders.forEach(function (order) {
      if (existsInColumn(sheet, col['單號'], order.orderNo)) {
        results.push({ orderNo: order.orderNo, status: 'duplicate' });
        return;
      }
      if (order.revertOf && existsInColumn(sheet, col['沖銷單號'], order.revertOf)) {
        results.push({ orderNo: order.orderNo, status: 'already_reverted' });
        return;
      }
      order.lines.forEach(function (l) { rows.push(toRow(order, l, col)); });
      results.push({ orderNo: order.orderNo, status: 'written' });
    });

    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      SpreadsheetApp.flush(); // 讓「目前庫存」公式重算
    }
    return { success: true, results: results, stock: readStockMap() };
  } finally {
    lock.releaseLock();
  }
}
```

* `existsInColumn` 使用 `createTextFinder(orderNo).matchEntireCell(true)`，不用把整欄讀進記憶體。
* 同一批次裡也要做冪等檢查（同一個單號在 payload 中出現兩次時，只寫入一次）。
* `already_reverted` 在前端視為「成功但被拒」：標記為 SYNCED，並向使用者提示。
* **現場數量扣減**：只對 `written` 的單據，把每個有 `productId` 的行（商品、贈品）依數量從商品表的「現場數量」扣掉（沖銷為負數量，所以等於加回）；該格留白就跳過。和寫入銷售紀錄在同一個 Lock 內完成，`duplicate` 不會重複扣。
* 回應的 `stock` 同時帶回現場數量：`{ [productId]: { stock, onSite } }`。

### 7.3 `GET ?action=summary&date=YYYY-MM-DD&event=名稱`：當日 / 本場次結算

* `event` 選填：有傳時，另外回傳該場次（不限日期）的同樣格式加總，供結算頁的「本場次」使用。
* 加總「銷售紀錄」中該日期（依腳本時區 `Asia/Taipei`）所有列的「小計」，回傳 `{ total, byPaymentMethod: { [method]: amount }, orderCount, revertCount }`。
* 範圍涵蓋**所有裝置**，Revert 已經抵銷，數字就是當天實收。

### 7.4 商品圖片

* 使用者在「圖片連結」欄貼上 Drive 分享連結。檔案的分享權限由使用者自己決定：沒有公開的圖片載入會失敗，前端降級顯示字卡，不另外提示。
* 不需要 OAuth、不需要 Token：GAS 轉成 lh3 網址後交給前端。
* **減肥：在 Google 端縮圖**。在 lh3 網址後面加上尺寸參數 `=s<px>-c`（例如 `=s400-c`：縮到 400px 並從中央裁成正方形），由 Google 端處理好再下載，不需要第三方套件。試算表的「圖片預覽」用 `=s200-c`。尺寸由前端依按鈕大小決定（建議用按鈕尺寸 × devicePixelRatio，上限 400）。
* **離線**：lh3 會回傳 `access-control-allow-origin: *`（已用實際的 Drive 圖片驗證 `/d/<id>=s400-c` 路徑），所以可以直接 `fetch` 成 Blob 存進 Dexie `images` 表，畫面用 `URL.createObjectURL(blob)` 渲染。
  * 選用：在存進 Dexie 前用 `createImageBitmap` + `OffscreenCanvas.convertToBlob({ type: 'image/webp', quality: 0.8 })` 轉成 WebP，再省一些空間。這是瀏覽器原生 API，同樣不需要第三方套件。
  * 如果 `/d/` 路徑實測沒有 CORS，就退回 Workbox runtime cache（`CacheFirst`，接受 opaque response）。代價是 Chrome 對每個 opaque response 會估約 7MB 的配額。
* 「同步商品圖」按鈕：比對 `images.sourceUrl` 和最新的 `imageUrl`，只下載有變更的圖片。
* 沒有圖或載入失敗時，降級為「商品名稱首字大字卡」。

---

## 8. 前端 UI / UX 規範（UI 細節邊做邊討論）

1. **觸控防呆**：商品按鈕 ≥ 64×64 px、間距 8 px；全域設定 `touch-action: manipulation`；SOLD OUT 按鈕反灰。
2. **快速找零**：結帳 Modal 提供 `剛好`、`$100`、`$500`、`$1000` 快捷鍵，應找金額以 ≥ 36 px 粗體顯示。
3. **支付方式**：按鈕來自 `Settings.paymentMethods`，點選即完成記帳。後端只記錄文字。
4. **手動改價**：購物車品項可以長按或點擊改單價（source = MANUAL）；結帳 Modal 提供「整單改價」。
5. **防休眠**：進入收銀畫面時呼叫 `navigator.wakeLock.request('screen')`，`visibilitychange` 時重新取得。
6. **同步狀態指示**：常駐顯示 PENDING 筆數和最後同步時間。
7. **結算畫面（今日收入）**：
   * 上線時呼叫 `?action=summary`，取得所有裝置的當日總額和各支付方式小計，再加上本機還沒同步的單據（標示「含 N 筆未同步」）。
   * 離線時只顯示本機 outbox 的當日加總，並標示「僅本機資料」。
   * 有設定場次時，另外顯示「本場次」的同樣數字（跨天場次的整場合計）。
   * 不需要新增分頁，也不做零用金或盤點。
8. **場次**：收銀畫面上方顯示「目前場次：CWT70 ▾」，點擊可以設定 / 切換 / 選「不指定」；輸入名稱時從 `recentEvents` 自動完成。過期後提示開始新場次。
9. **現場數量**：商品卡有現場數量時，顯示現場剩餘（AvailableOnSite）；扣到 0 以下顯示 SOLD OUT 與警告。

### 8.1 條碼與掃碼

條碼由 Till 自己產生，不使用商品原本的 EAN / ISBN。一個商品只有一個代碼；不同顏色、款式一律視為不同商品。

**商品代碼**

* 用新欄位「商品代碼」，不直接用 `id` 或品名：
  * `id` 太長，印出來的條碼很寬、相機難掃，也無法人工輸入。
  * 品名可能含中文（Code128 放不下），改名後已印的標籤會失效。
* 純數字、從 1001 開始流水號：
  * 開頭不會是 0，欄位仍設為純文字格式作為雙重保險。
  * 純數字的 Code128 最短、最好掃。
  * 掃不到時可以用數字鍵盤人工輸入。
  * 數字鍵的實體位置固定，不受注音輸入法影響。
* 自動填入：
  * 新增商品時由 `VIBE_ON_EDIT` hook 補上「目前最大代碼 + 1」。
  * `bootstrap` 讀取時，遇到空白的代碼也會在 Lock 內補上（同 4.1 的雙重保險）。
* 代碼重複時，前端加入 `catalogWarnings`，該代碼只對應到表格中的第一筆。

**藍牙掃碼槍（主要）**

* 掃碼槍使用 **HID 鍵盤模式**：系統把它當成外接鍵盤，所以 iPad、Android、筆電都能用，不需要 Web Bluetooth。
* 建議購買「2D 影像式」掃碼槍，QR 和一維條碼都能掃。便宜的雷射或 CCD 槍只能掃一維條碼。
* 偵測方式：
  * 全域監聽 `keydown`。
  * 用 `event.code`（`Digit1`、`Numpad1`）還原數字，不用 `event.key`，避免注音輸入法把 `1` 轉成「ㄅ」。
  * 字元間隔 ≤ 約 50ms、以 Enter 結尾，判定為一次掃碼；人手打字不會被誤判。
* 只在「收銀」分頁、而且沒有開啟任何視窗時接受掃碼；其他時候忽略。
* 掃到之後：
  * 該商品數量 +1，賣完時沿用 SOLD OUT 確認。
  * 回饋為嗶聲（Web Audio）加上商品卡閃動。
  * 找不到代碼時播放錯誤音，並顯示「找不到商品代碼 xxxx」。依設計不應發生，但打錯字仍可能遇到。

**相機掃碼（次要）**

* 收銀畫面提供相機按鈕，開啟後可以連續掃描，掃到就加入購物車。一直對著同一個條碼只算一次，移開 1.5 秒以上再對準才算下一件。
* 同時辨識 QR 和 Code128：
  * 有原生 `BarcodeDetector` 時優先使用（Android Chrome）。
  * 沒有時改用 `barcode-detector` ponyfill（內含 zxing wasm，iOS Safari），只在開啟相機時才載入；wasm 隨 App 一起部署，不依賴外部 CDN。

**網頁數字鍵盤**

* 平板或手機連上掃碼槍後，系統會收起螢幕鍵盤，所以 Till 自帶數字鍵盤，以下情境共用：
  * 手動輸入商品代碼（收銀畫面的「輸入代碼」按鈕）。
  * 單品改價、整單改價。
  * 結帳的實收金額。
* 不論有沒有接掃碼槍都使用同一套操作。
* 實作方式：欄位仍是 `<input>`，但設為 `inputMode="none"`（點了不叫出系統鍵盤，筆電上仍可直接打字），下方顯示網頁數字鍵盤；第一次按數字會取代原值（改價時直接打新價格）。
* 「輸入代碼」視窗開著時，掃碼槍的輸入會直接打進欄位，按 Enter 即加入購物車。
* 「備註」這類文字欄位仍使用系統鍵盤。接著掃碼槍時是已知限制：iPad 可以從下方工具列手動叫出鍵盤。

**標籤列印**

* 「設定」頁進入標籤頁：勾選商品、設定每個商品印幾張（預設 1 張）。
* 版面：
  * 固定 A4 白紙，邊界 10mm、每頁 3 × 8 = 24 格（每格約 63 × 35mm），格子之間印虛線裁切線。
  * 每格是條碼，條碼下方印品名和代碼數字。
  * 條碼格式可選 Code128（預設）或 QR。
  * 使用者要印在白紙上剪下，或自行改用 A4 貼紙，由使用者決定，系統不內建貼紙規格。
* 產生方式：
  * 用 canvas 以 300dpi 畫出每一頁，品名由瀏覽器字型繪製，所以不需要在 PDF 內嵌中文字型。
  * 再用 jsPDF 包成 PDF；條碼用 bwip-js 或 JsBarcode。
  * 這些函式庫只在進入標籤頁時才載入。
* 輸出方式：
  * 直接下載 PDF。
  * 手機上可用 Web Share API 分享到其他 App。
* **不做**：
  * 上傳 Google Drive：`drive.file` 權限做得到，但目前不需要。
  * 串接 ibon／全家雲端列印：兩家都沒有公開 API，模擬網頁上傳容易壞，也可能違反使用條款。需要時，使用者自行把 PDF 上傳到超商列印網站，用 A4 白紙印出。

---

## 9. 開發階段清單（Implementation Roadmap）

* [x] **Phase 0: vibe-sheets 擴充**（已發布 0.4.0）（`/Users/glenn.jong/Works/self/vibe-sheets`）
  * `createSheet` 支援 `tabs`、`arrayFormula`、`validation`、`note`、`{{Tab.col}}` 佔位符、`setupRequests`
  * `script.code` 注入 + `VIBE_ROUTES` 分派（沿用 `action` / `method` 別名，保留字不可覆蓋）
  * 基礎腳本內建 `onEdit`：自動填入 `id / created_at / updated_at / is_enabled`，並提供 `VIBE_ON_EDIT` hook
  * `hidden` 分頁、`readonly` 欄位
  * `upgradeScript`（更新既有 deployment，網址不變）
  * 保持舊 API 相容，用 money-book 做回歸測試
* [x] **Phase 1: 環境與資料層**（程式完成；待實機驗證建表與圖片 CORS）
  * Vite + React + Tailwind + Dexie 初始化
  * 沿用 money-book 的 Setup / SheetSelector（prefix `till-`）
  * 撰寫 Till 的 `tabs` 定義與 GAS `script.code`（bootstrap / orders / summary / onEdit）
  * ~~用實際的 Drive 圖片驗證 lh3 `/d/<id>=s400` 有沒有回傳 CORS 標頭~~（已驗證：有回傳 `access-control-allow-origin: *`，`=s<px>-c` 可裁成正方形）
* [x] **Phase 2: 計價與狀態引擎**（`src/lib/pricing.ts`；組合以「格子」模型實作：固定組合每個品項一格、任選 N 件為 N 格，固定組合也能填分類）
  * 計價管線（Bundle 貪婪〔FIXED / PICK〕→ Promotion 分組擇優 → 整單手調），補上單元測試
  * 購物車 Reducer（增減、清空、單品改價、整單改價）
* [x] **Phase 3: Outbox 與同步**（`src/lib/outbox.ts`、`src/lib/sync.tsx`；單據以 `seq` 保證送出順序，跨分頁以 Web Locks + IndexedDB transaction 防重送）
  * 批次同步、指數退避、冷啟動自我修復、三種庫存刷新模式
  * Revert 流程
* [x] **Phase 4: 收銀 UI**（收銀 / 訂單 / 結算 / 設定四頁；訂單頁只列本機訂單）
  * 商品網格與分類 Tab、購物車、促銷即時提示、找零與支付選擇、歷史訂單與 Revert、結算畫面
* [ ] **Phase 5: PWA 與現場調校**
  * 圖片同步（lh3 縮圖 → Dexie Blob）、Wake Lock、腳本版本升級提示
* [x] **Phase 6: 場次、總庫存與銷量統計**（見 4.3、工作表 5；程式完成，`銷量統計` 與 `_選單.場次選項` 的公式待開新帳本實測）
  * 商品表：「備貨數量」改為「總進貨量」（GAS 相容舊標題），新增「現場數量」「備註」
  * 銷售紀錄新增「場次」欄；outbox 單據帶 `event`，沖銷沿用原單
  * GAS：orders 寫入時扣減 / 加回現場數量、回傳 onSite；bootstrap 回傳 `recentEvents`；summary 支援 `event`
  * 新增 `銷量統計` 分頁（場次下拉 + 公式 + 保護）
  * App：場次設定（名稱 + 結束時間、自動過期、自動完成）、現場剩餘與 SOLD OUT、結算頁「本場次」
  * 調高 `SCRIPT_VERSION`；完成後開新帳本實測
* [x] **Phase 7: 條碼**（見 8.1；程式完成，待實機驗證掃碼槍、相機與列印）
  * 商品表新增「商品代碼」欄：純文字格式、重複標紅、`VIBE_ON_EDIT` 和 `bootstrap` 自動編號；調高 `SCRIPT_VERSION`
  * 掃碼槍輸入偵測（`event.code`、時間間隔、Enter 結尾）+ 嗶聲 / 閃動回饋
  * 網頁數字鍵盤（代碼輸入、改價、實收金額共用）
  * 標籤頁：A4 白紙 + 裁切線，條碼 + 品名 + 代碼，canvas → PDF 下載 / 分享
  * 相機掃碼（次要）：`BarcodeDetector`，不支援時改用 zxing wasm
