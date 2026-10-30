import { useEffect, useRef } from 'react';

// 藍牙掃碼槍（HID 鍵盤模式）輸入偵測（見 spec 8.1）
// 掃碼槍會在極短時間內「打」完整串字元再按 Enter；人手打字的間隔長得多，不會被誤判
// 以 event.code（實體按鍵位置）還原字元，不用 event.key，避免注音輸入法把 1 轉成「ㄅ」

const MAX_GAP_MS = 50;
const MIN_LENGTH = 3;

export function charFromCode(code: string): string | null {
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit) return digit[1];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  if (code === 'Minus' || code === 'NumpadSubtract') return '-';
  return null;
}

export type ScanKeyResult = 'scan' | 'buffered' | 'ignored';

export function createScanDetector(onScan: (code: string) => void, options: { maxGapMs?: number; minLength?: number } = {}) {
  const maxGap = options.maxGapMs ?? MAX_GAP_MS;
  const minLength = options.minLength ?? MIN_LENGTH;
  let buffer = '';
  let lastAt = -Infinity;

  return (code: string, timeStamp: number): ScanKeyResult => {
    const fast = timeStamp - lastAt <= maxGap;
    lastAt = timeStamp;

    if (code === 'Enter' || code === 'NumpadEnter') {
      const scanned = fast && buffer.length >= minLength ? buffer : '';
      buffer = '';
      if (!scanned) return 'ignored';
      onScan(scanned);
      return 'scan';
    }

    const char = charFromCode(code);
    if (char === null) {
      buffer = '';
      return 'ignored';
    }
    // 間隔太長：視為新的一串（前面的是人手打的字）
    buffer = fast ? buffer + char : char;
    return 'buffered';
  };
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

// 只在沒有開啟任何視窗、也不是在輸入框打字時接受掃碼
export function useBarcodeScanner(onScan: (code: string) => void) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    const detect = createScanDetector(code => onScanRef.current(code));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('[role="dialog"]')) return;
      // Enter 結束掃碼時攔下來，避免觸發剛點過、仍有焦點的商品按鈕
      if (detect(e.code, e.timeStamp) === 'scan') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
