import { useEffect, useRef, useState } from 'react';
import Modal from '../components/Modal';

// 相機掃碼（次要功能，見 spec 8.1）：連續掃描，QR 與 Code128 都認得
// 有原生 BarcodeDetector（Android Chrome）就用原生；沒有時（iOS Safari）載入打包好的 zxing wasm，不依賴外部 CDN

const FORMATS = ['qr_code', 'code_128'];
const SCAN_INTERVAL_MS = 250;
const SAME_CODE_COOLDOWN_MS = 1500;

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

async function createDetector(): Promise<Detector> {
  const Native = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
  if (Native) {
    try {
      const supported: string[] = await Native.getSupportedFormats();
      if (FORMATS.every(f => supported.includes(f))) return new Native({ formats: FORMATS });
    } catch {
      // 改用 wasm
    }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url')
  ]);
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) }
  });
  return new BarcodeDetector({ formats: FORMATS as any });
}

export default function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [status, setStatus] = useState('開啟相機中…');

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lastSeen = new Map<string, number>();

    (async () => {
      try {
        const [detector, media] = await Promise.all([
          createDetector(),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        ]);
        stream = media;
        if (stopped) return;
        const video = videoRef.current!;
        video.srcObject = media;
        await video.play();
        setStatus('對準條碼或 QR code');

        const tick = async () => {
          if (stopped) return;
          try {
            for (const { rawValue } of await detector.detect(video)) {
              // 一直對著同一個條碼只算一次；移開超過冷卻時間再對準，才算下一件
              const now = Date.now();
              const previous = lastSeen.get(rawValue) ?? 0;
              lastSeen.set(rawValue, now);
              if (now - previous >= SAME_CODE_COOLDOWN_MS) onCodeRef.current(rawValue);
            }
          } catch {
            // 單張畫面辨識失敗就略過
          }
          timer = setTimeout(tick, SCAN_INTERVAL_MS);
        };
        tick();
      } catch (err) {
        setStatus(err instanceof DOMException && err.name === 'NotAllowedError' ? '沒有相機權限，請在瀏覽器設定中允許使用相機' : `無法開啟相機：${err}`);
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <Modal title="相機掃碼" onClose={onClose}>
      <video ref={videoRef} playsInline muted className="aspect-square w-full rounded-xl bg-black object-cover" />
      <p className="mt-3 text-center text-sm text-stone-500">{status}</p>
      <button onClick={onClose} className="mt-3 h-12 w-full rounded-xl bg-stone-900 font-bold text-white">
        完成
      </button>
    </Modal>
  );
}
