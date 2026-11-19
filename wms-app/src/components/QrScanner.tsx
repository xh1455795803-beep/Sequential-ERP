import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, X, Flashlight } from 'lucide-react';

interface Props {
  onDetected: (code: string) => void;
  placeholder?: string;
  autoStop?: boolean;
}

export function QrScanner({ onDetected, placeholder = '扫描条码 / 二维码', autoStop = true }: Props) {
  const [manualCode, setManualCode] = useState('');
  const [scannerOn, setScannerOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scanAreaId = 'pda-qr-area';

  useEffect(() => {
    if (!scannerOn) return;

    const scanner = new Html5Qrcode(scanAreaId);
    scannerRef.current = scanner;

    const config = { fps: 10, qrbox: { width: 250, height: 150 } };

    scanner.start(
      { facingMode: 'environment' } as any,
      config,
      (decodedText) => {
        onDetected(decodedText);
        if (autoStop) {
          scanner.stop().catch(() => {}).then(() => {
            scanner.clear().catch(() => {});
            setScannerOn(false);
          });
        }
      },
      () => {},
    ).catch((err) => {
      const msg = typeof err === 'string' ? err : (err?.message || '摄像头启动失败');
      setError(msg);
      setScannerOn(false);
    });

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {}).then(() => {
          scannerRef.current?.clear().catch(() => {});
        });
      }
    };
  }, [scannerOn, onDetected, autoStop]);

  const toggle = () => {
    setError(null);
    setScannerOn((v) => !v);
  };

  return (
    <div className="space-y-3">
      {/* 手动输入区（扫码枪也用这个） */}
      <div className="flex gap-2">
        <input
          type="text"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && manualCode.trim()) {
              onDetected(manualCode.trim());
              setManualCode('');
            }
          }}
          placeholder={placeholder}
          className="flex-1 px-4 py-3 text-base border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
          autoFocus
          inputMode="text"
          enterKeyHint="done"
        />
        <button
          onClick={() => {
            if (manualCode.trim()) {
              onDetected(manualCode.trim());
              setManualCode('');
            }
          }}
          className="px-4 py-3 bg-brand-500 text-white rounded-xl active:bg-brand-600 text-sm font-medium"
        >
          确认
        </button>
      </div>

      {/* 摄像头扫码区 */}
      {!scannerOn ? (
        <button
          onClick={toggle}
          className="w-full flex items-center justify-center gap-2 py-4 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-xl active:opacity-90"
        >
          <Camera className="w-5 h-5" />
          <span className="font-medium">打开摄像头扫码</span>
        </button>
      ) : (
        <div className="relative rounded-xl overflow-hidden bg-black">
          <div id={scanAreaId} className="w-full aspect-video" />
          <button
            onClick={toggle}
            className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-500 bg-red-50 p-2 rounded-lg">
          {error}
        </div>
      )}
    </div>
  );
}
