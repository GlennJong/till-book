import { describe, expect, it } from 'vitest';
import { charFromCode, createScanDetector } from './scanner';

// 掃碼槍的按鍵間隔約數毫秒；人手打字通常超過 100ms
const type = (detect: ReturnType<typeof createScanDetector>, codes: string[], start: number, gap: number) =>
  codes.map((code, i) => detect(code, start + i * gap));

const keys = (text: string) => [...Array.from(text, c => (/\d/.test(c) ? `Digit${c}` : `Key${c}`)), 'Enter'];

describe('scan detector', () => {
  it('reads a fast burst ending with Enter as one scan', () => {
    const scans: string[] = [];
    const detect = createScanDetector(code => scans.push(code));
    const results = type(detect, keys('1001'), 1000, 8);
    expect(scans).toEqual(['1001']);
    expect(results.at(-1)).toBe('scan');
  });

  it('ignores human typing', () => {
    const scans: string[] = [];
    const detect = createScanDetector(code => scans.push(code));
    type(detect, keys('1001'), 1000, 150);
    expect(scans).toEqual([]);
  });

  it('drops slowly typed keys before a burst', () => {
    const scans: string[] = [];
    const detect = createScanDetector(code => scans.push(code));
    detect('Digit9', 0);
    type(detect, keys('1002'), 500, 5);
    expect(scans).toEqual(['1002']);
  });

  it('ignores short bursts and resets on unknown keys', () => {
    const scans: string[] = [];
    const detect = createScanDetector(code => scans.push(code));
    type(detect, ['Digit1', 'Digit2', 'Enter'], 0, 5);
    type(detect, ['Digit1', 'Digit2', 'ShiftLeft', 'Digit3', 'Enter'], 100, 5);
    expect(scans).toEqual([]);
  });

  it('maps physical keys, so an active Bopomofo IME does not matter', () => {
    expect(['Digit1', 'Numpad7', 'KeyA', 'Minus', 'Space'].map(charFromCode)).toEqual(['1', '7', 'A', '-', null]);
    const scans: string[] = [];
    const detect = createScanDetector(code => scans.push(code));
    type(detect, ['Numpad1', 'Numpad0', 'Numpad0', 'Numpad3', 'NumpadEnter'], 0, 3);
    expect(scans).toEqual(['1003']);
  });
});
