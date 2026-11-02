import { createContext, runInContext } from 'node:vm';
import { getFullScriptContent } from '@glennjong/vibe-sheets';
import { SCRIPT_VERSION, TILL_SCRIPT } from '../backend/schema';

// 在 Node 裡模擬「部署後的 Web App」：vibe-sheets 基礎腳本 + Till 自訂腳本，跑在記憶體中的假試算表上

export type Cell = string | number | boolean | Date | null;

const columnLetter = (col: number) => {
  let letter = '';
  while (col > 0) {
    letter = String.fromCharCode(65 + ((col - 1) % 26)) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
};

// 資料驗證規則：模擬 SpreadsheetApp.newDataValidation() 建出來的物件
export interface MockRule {
  type: 'CHECKBOX' | 'VALUE_IN_RANGE' | 'VALUE_IN_LIST';
  values: unknown[];
  allowInvalid: boolean;
  getCriteriaType: () => string;
  getCriteriaValues: () => unknown[];
}

const newDataValidation = () => {
  let type: MockRule['type'] = 'CHECKBOX';
  let values: unknown[] = [];
  let allowInvalid = false;
  const builder = {
    requireCheckbox: () => builder,
    requireValueInRange: (range: unknown) => ((type = 'VALUE_IN_RANGE'), (values = [range]), builder),
    requireValueInList: (list: string[]) => ((type = 'VALUE_IN_LIST'), (values = [list]), builder),
    setAllowInvalid: (allow: boolean) => ((allowInvalid = allow), builder),
    build: (): MockRule => ({ type, values, allowInvalid, getCriteriaType: () => type, getCriteriaValues: () => values })
  };
  return builder;
};

export class MockSheet {
  rows: Cell[][];
  maxRows: number;
  maxColumns: number;
  formulas = new Map<string, string>(); // "列,欄"（1 起算）→ 公式
  validations = new Map<string, MockRule>();
  notes = new Map<string, string>();
  frozenRows = 0;
  hidden = false;
  protections: { warningOnly?: boolean; description?: string; unprotected?: string[] }[] = [];

  constructor(public name: string, rows: Cell[][], maxRows = 1000) {
    this.rows = rows;
    this.maxRows = maxRows;
    this.maxColumns = Math.max(26, ...rows.map(r => r.length));
  }
  getName() {
    return this.name;
  }
  getLastColumn() {
    return (this.rows[0] || []).length;
  }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].some(v => v !== '' && v !== null)) return i + 1;
    }
    return 0;
  }
  getMaxRows() {
    return this.maxRows;
  }
  getMaxColumns() {
    return this.maxColumns;
  }
  insertColumnsAfter(_after: number, howMany: number) {
    this.maxColumns += howMany;
  }
  // 在第 col 欄前插入一欄：每一列、公式、驗證都往右移
  insertColumnBefore(col: number) {
    this.rows.forEach(r => r.length >= col - 1 && r.splice(col - 1, 0, ''));
    for (const map of [this.formulas, this.validations, this.notes] as Map<string, unknown>[]) {
      const moved = [...map].map(([key, v]) => {
        const [r, c] = key.split(',').map(Number);
        return [c >= col ? `${r},${c + 1}` : key, v] as const;
      });
      map.clear();
      moved.forEach(([key, v]) => map.set(key, v));
    }
    this.maxColumns += 1;
  }
  insertRowsAfter(_after: number, howMany: number) {
    this.maxRows += howMany;
  }
  setFrozenRows(n: number) {
    this.frozenRows = n;
  }
  hideSheet() {
    this.hidden = true;
  }
  getProtections() {
    return this.protections.map(p => this.protectionHandle(p));
  }
  protect() {
    const p = {};
    this.protections.push(p);
    return this.protectionHandle(p);
  }
  private protectionHandle(p: MockSheet['protections'][number]) {
    const handle = {
      setWarningOnly: (v: boolean) => ((p.warningOnly = v), handle),
      setDescription: (v: string) => ((p.description = v), handle),
      setUnprotectedRanges: (ranges: { getA1Notation: () => string }[]) => ((p.unprotected = ranges.map(r => r.getA1Notation())), handle)
    };
    return handle;
  }
  getDataRange() {
    return this.getRange(1, 1, this.getLastRow(), this.getLastColumn());
  }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    const cells = (fn: (r: number, c: number) => void) => {
      for (let r = row; r < row + numRows; r++) for (let c = col; c < col + numCols; c++) fn(r, c);
    };
    const read = () =>
      Array.from({ length: numRows }, (_, r) =>
        Array.from({ length: numCols }, (_, c) => this.rows[row - 1 + r]?.[col - 1 + c] ?? '')
      );
    const setCell = (r: number, c: number, v: Cell) => {
      while (this.rows.length < r) this.rows.push(new Array(this.getLastColumn()).fill(''));
      this.rows[r - 1][c - 1] = v;
    };
    // 字串以 = 開頭時當成公式；標題列的 ={"名稱"; …} 顯示名稱，其他公式結果不模擬
    const setFormula = (r: number, c: number, formula: string) => {
      this.formulas.set(`${r},${c}`, formula);
      setCell(r, c, /^=\{"([^"]+)"/.exec(formula)?.[1] ?? '');
    };
    const write = (values: Cell[][]) => {
      if (row + values.length - 1 > this.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      values.forEach((line, r) =>
        line.forEach((v, c) => {
          this.formulas.delete(`${row + r},${col + c}`);
          if (typeof v === 'string' && v.startsWith('=')) setFormula(row + r, col + c, v);
          else setCell(row + r, col + c, v);
        })
      );
    };
    const range = {
      getRow: () => row,
      getColumn: () => col,
      getLastRow: () => row + numRows - 1,
      getLastColumn: () => col + numCols - 1,
      getSheet: () => this,
      getA1Notation: () =>
        numRows === 1 && numCols === 1 ? `${columnLetter(col)}${row}` : `${columnLetter(col)}${row}:${columnLetter(col + numCols - 1)}${row + numRows - 1}`,
      getValues: read,
      getValue: () => read()[0][0],
      getFormulas: () =>
        Array.from({ length: numRows }, (_, r) => Array.from({ length: numCols }, (_, c) => this.formulas.get(`${row + r},${col + c}`) ?? '')),
      getFormula: () => this.formulas.get(`${row},${col}`) ?? '',
      setValues: (values: Cell[][]) => (write(values), range),
      setValue: (v: Cell) => (write([[v]]), range),
      setFormula: (f: string) => (setFormula(row, col, f), range),
      clearContent: () => (cells((r, c) => (this.formulas.delete(`${r},${c}`), this.rows[r - 1] && (this.rows[r - 1][c - 1] = ''))), range),
      setDataValidation: (rule: MockRule) => (cells((r, c) => this.validations.set(`${r},${c}`, rule)), range),
      getDataValidation: () => this.validations.get(`${row},${col}`) ?? null,
      setNote: (note: string) => (this.notes.set(`${row},${col}`, note), range),
      setFontWeight: () => range,
      setBackground: () => range,
      setNumberFormat: () => range,
      createTextFinder: (text: string) => ({
        matchEntireCell: () => ({
          findNext: () => (read().some(line => line.some(v => String(v) === text)) ? {} : null)
        })
      })
    };
    return range;
  }
}

export interface GasEnvironment {
  sheets: Record<string, MockSheet>;
  ctx: Record<string, any>;
  recalc: () => void;
}

export function createGasEnvironment(
  sheets: Record<string, MockSheet>,
  // migrated：假裝帳本結構已是最新版（只測同步、不測升級的測試用，避免欄位位置被升級改動）
  options: { customCode?: string; recalc?: () => void; migrated?: boolean } = {}
): GasEnvironment {
  let uuid = 0;
  const recalc = options.recalc ?? (() => {});
  const properties = new Map<string, string>(options.migrated ? [['tillSchemaVersion', SCRIPT_VERSION]] : []);
  const documentProperties = {
    getProperty: (key: string) => properties.get(key) ?? null,
    setProperty: (key: string, value: string) => properties.set(key, value)
  };
  const ctx: Record<string, any> = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n: string) => sheets[n] || null,
        getSheets: () => Object.values(sheets),
        insertSheet: (n: string) => (sheets[n] = new MockSheet(n, [[]]))
      }),
      flush: recalc,
      newDataValidation,
      DataValidationCriteria: { VALUE_IN_RANGE: 'VALUE_IN_RANGE', VALUE_IN_LIST: 'VALUE_IN_LIST' },
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' }
    },
    PropertiesService: { getDocumentProperties: () => documentProperties },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this; } })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      // 以 UTC+8 模擬 Asia/Taipei
      formatDate: (d: Date) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' }
  };
  createContext(ctx);
  runInContext(getFullScriptContent(), ctx);
  if (options.customCode) runInContext(options.customCode, ctx);
  recalc();
  return { sheets, ctx, recalc };
}

// 和實際部署相同：注入版本號與帳本結構清單
export const loadTillScript = () => TILL_SCRIPT.code;

// 把 fetch 導到假的 Web App；可指定「伺服器已處理但回應遺失」來模擬斷線
export function routeFetchTo(env: GasEnvironment) {
  const state = { dropNextResponse: false, failNextRequest: false, requests: [] as { action: string | null; body?: any }[] };

  const fetchImpl = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const parameter = Object.fromEntries(url.searchParams);
    const body = init?.body === undefined ? undefined : String(init.body);
    state.requests.push({ action: parameter.action ?? null, body: body && JSON.parse(body) });

    if (state.failNextRequest) {
      state.failNextRequest = false;
      throw new TypeError('Failed to fetch');
    }

    // 模擬網路延遲，讓並行請求有機會交錯
    await new Promise(resolve => setTimeout(resolve, 5));
    const out = init?.method === 'POST'
      ? env.ctx.doPost({ parameter, postData: { contents: body } })
      : env.ctx.doGet({ parameter });

    if (state.dropNextResponse) {
      state.dropNextResponse = false;
      throw new TypeError('Failed to fetch');
    }
    return { ok: true, status: 200, text: async () => out.text } as Response;
  };

  return { fetchImpl, state };
}
