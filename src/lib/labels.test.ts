import { describe, expect, it } from 'vitest';
import { CELL_MM, cellOrigin, LABELS_PER_PAGE, paginateLabels } from './labels';

describe('label layout', () => {
  it('expands copies and splits into A4 pages of 24', () => {
    const pages = paginateLabels([
      { item: { name: 'A', code: '1001' }, copies: 20 },
      { item: { name: 'B', code: '1002' }, copies: 0 },
      { item: { name: 'C', code: '1003' }, copies: 10 }
    ]);
    expect(LABELS_PER_PAGE).toBe(24);
    expect(pages.map(p => p.length)).toEqual([24, 6]);
    expect(pages[0][19].code).toBe('1001');
    expect(pages[0][20].code).toBe('1003');
  });

  it('fills cells left to right, top to bottom inside the 10mm margin', () => {
    expect(cellOrigin(0)).toEqual({ x: 10, y: 10 });
    expect(cellOrigin(2).x).toBeCloseTo(10 + 2 * CELL_MM.width);
    expect(cellOrigin(3)).toEqual({ x: 10, y: 10 + CELL_MM.height });
    // 最後一格的右下角剛好在 A4 的邊界內
    const last = cellOrigin(23);
    expect(last.x + CELL_MM.width).toBeCloseTo(200);
    expect(last.y + CELL_MM.height).toBeCloseTo(287);
  });
});
