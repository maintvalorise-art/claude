import { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal } from './ui';

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

/**
 * Champ de scan : compatible douchette USB (saisie + Entrée) et caméra du téléphone
 * (API BarcodeDetector, disponible sur Chrome Android).
 */
export default function ScanInput({
  onScan, placeholder = 'Scanner ou saisir le code…', autoFocus = true,
}: {
  onScan: (code: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  const supported = typeof window !== 'undefined' && !!window.BarcodeDetector;

  function submit(code: string) {
    const c = code.trim();
    if (!c) return;
    onScan(c);
    setValue('');
  }

  return (
    <div className="flex gap-2">
      <Input
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit(value);
          }
        }}
      />
      <Button variant="secondary" onClick={() => submit(value)}>OK</Button>
      {supported && <Button onClick={() => setCamera(true)} aria-label="Scanner avec la caméra">📷</Button>}
      <Modal open={camera} onClose={() => setCamera(false)} title="Scanner le code">
        {camera && <CameraScanner onDetected={(c) => { setCamera(false); submit(c); }} />}
      </Modal>
    </div>
  );
}

function CameraScanner({ onDetected }: { onDetected: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const callback = useRef(onDetected);
  callback.current = onDetected;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    const detector = new window.BarcodeDetector!({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop) {
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes.length) {
            callback.current(codes[0].rawValue);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setError("Impossible d'accéder à la caméra. Autorisez-la dans le navigateur ou saisissez le code.");
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-red-600">{error}</p> : <video ref={video} className="w-full rounded-lg bg-black" muted playsInline />}
      <p className="text-center text-xs text-slate-500">Visez le code-barres ou le QR code</p>
    </div>
  );
}
