import { createContext, runInContext } from 'node:vm';
import { getFullScriptContent } from '@glennjong/vibe-sheets';
import tillScript from '../backend/till.gs.js?raw';

// 在 Node 裡模擬「部署後的 Web App」：vibe-sheets 基礎腳本 + Till 自訂腳本，跑在記憶體中的假試算表上

export type Cell = string | number | boolean | Date | null;

export class MockSheet {
  rows: Cell[][];
  maxRows: number;
  constructor(public name: string, rows: Cell[][], maxRows = 1000) {
    this.rows = rows;
    this.maxRows = maxRows;
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
  insertRowsAfter(_after: number, howMany: number) {
    this.maxRows += howMany;
  }
  getDataRange() {
    return this.getRange(1, 1, this.getLastRow(), this.getLastColumn());
  }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    const read = () =>
      Array.from({ length: numRows }, (_, r) =>
        Array.from({ length: numCols }, (_, c) => this.rows[row - 1 + r]?.[col - 1 + c] ?? '')
      );
    const write = (values: Cell[][]) => {
      if (row + values.length - 1 > this.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      values.forEach((line, r) => {
        while (this.rows.length < row + r) this.rows.push(new Array(this.getLastColumn()).fill(''));
        line.forEach((v, c) => {
          this.rows[row - 1 + r][col - 1 + c] = v;
        });
      });
    };
    return {
      getRow: () => row,
      getColumn: () => col,
      getLastRow: () => row + numRows - 1,
      getLastColumn: () => col + numCols - 1,
      getSheet: () => this,
      getValues: read,
      getValue: () => read()[0][0],
      setValues: write,
      setValue: (v: Cell) => write([[v]]),
      setDataValidation: () => {},
      createTextFinder: (text: string) => ({
        matchEntireCell: () => ({
          findNext: () => (read().some(line => line.some(v => String(v) === text)) ? {} : null)
        })
      })
    };
  }
}

export interface GasEnvironment {
  sheets: Record<string, MockSheet>;
  ctx: Record<string, any>;
  recalc: () => void;
}

export function createGasEnvironment(
  sheets: Record<string, MockSheet>,
  options: { customCode?: string; recalc?: () => void } = {}
): GasEnvironment {
  let uuid = 0;
  const recalc = options.recalc ?? (() => {});
  const ctx: Record<string, any> = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n: string) => sheets[n] || null,
        getSheets: () => Object.values(sheets)
      }),
      flush: recalc,
      newDataValidation: () => {
        const builder = { requireCheckbox: () => builder, setAllowInvalid: () => builder, build: () => 'checkbox' };
        return builder;
      }
    },
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

export const loadTillScript = () => tillScript;

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
