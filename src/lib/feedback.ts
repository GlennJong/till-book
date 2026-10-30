// 掃碼回饋音：成功短而高、失敗長而低。用 Web Audio 現場合成，不需要音效檔

let context: AudioContext | null = null;

export function beep(kind: 'ok' | 'error') {
  try {
    context ??= new AudioContext();
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = kind === 'ok' ? 'sine' : 'square';
    osc.frequency.value = kind === 'ok' ? 1400 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(context.destination);
    const duration = kind === 'ok' ? 0.08 : 0.3;
    osc.start();
    osc.stop(context.currentTime + duration);
  } catch {
    // 不支援或被瀏覽器擋下時靜音
  }
}
