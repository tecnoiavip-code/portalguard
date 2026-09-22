import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, X, Zap, ZapOff, ScanLine, Loader2, CheckCircle2 } from 'lucide-react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { toast } from 'sonner';
import { parsePackageLabel, ParsedPackageLabel } from '@/lib/package-label-parser';
import { supabase } from '@/integrations/supabase/client';

type AdvancedMediaTrackConstraints = MediaTrackConstraints & {
  advanced?: Array<Record<string, unknown>>;
};

interface ScanError extends Error {
  name: string;
}

interface PackageScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScanResult: (result: ParsedPackageLabel) => void;
  residents?: Array<{ id: string; name: string; apartment: string; phone?: string }>;
}

export const PackageScanner = ({ open, onOpenChange, onScanResult, residents = [] }: PackageScannerProps) => {
  const [scanning, setScanning] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualText, setManualText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopScanner = useCallback(() => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    if (controlsRef.current) {
      try { controlsRef.current.stop(); } catch { /* ignora */ }
      controlsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
    setTorchOn(false);
    setHasTorch(false);
  }, []);

  const handleBarcodeResult = useCallback(async (text: string) => {
    setProcessing(true);
    stopScanner();

    try {
      const parsed = parsePackageLabel(text);

      if (parsed.confidence < 10) {
        // Código detectado mas pouco reconhecível — ainda assim envia
        parsed.rawText = text;
        if (!parsed.trackingCode) {
          parsed.trackingCode = text.length > 5 ? text : undefined;
        }
        if (!parsed.sender) {
          parsed.sender = 'Não identificado';
        }
      }

      onScanResult(parsed);
      toast.success(`Etiqueta escaneada! Remetente: ${parsed.sender}`);
      onOpenChange(false);
    } catch (err) {
      console.error('[Scanner] Erro ao processar:', err);
      toast.error('Erro ao processar a etiqueta');
    } finally {
      setProcessing(false);
    }
  }, [stopScanner, onScanResult, onOpenChange]);

  const startScanner = useCallback(async () => {
    if (!videoRef.current) return;
    setProcessing(false);
    setError(null);

    try {
      const constraints: AdvancedMediaTrackConstraints = {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        // Câmeras sem foco manual: pedir foco contínuo automático
        focusMode: { ideal: 'continuous' },
        advanced: [
          { focusMode: 'continuous' },
          { whiteBalanceMode: 'auto' },
          { exposureMode: 'auto' },
        ],
      };
      const stream = await navigator.mediaDevices.getUserMedia({ video: constraints });

      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // Verificar suporte a tocha (torch)
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
      if (caps && 'torch' in caps) {
        setHasTorch(true);
      }

      // Tentar melhorar foco automaticamente via advanced settings
      try {
        const settings = track.getSettings();
        console.log('[Scanner] Camera settings:', settings);
      } catch { /* configurações não disponíveis */ }

      // Iniciar scanner de código de barras/QR
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      setScanning(true);

      const controls = await reader.decodeFromStream(
        stream,
        videoRef.current,
        (result, err, ctrl) => {
          // Ignorar erros transitórios de frame (vazio entre frames)
          if (err) return;
          if (result) {
            const text = result.getText();
            console.log('[Scanner] Código detectado:', text);
            ctrl.stop();
            controlsRef.current = null;
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            setScanning(false);
            handleBarcodeResult(text);
          }
        }
      );
      controlsRef.current = controls;
    } catch (err) {
      console.error('[Scanner] Erro:', err);
      const scanError = err as ScanError;
      if (scanError.name === 'NotAllowedError') {
        setError('Permissão de câmera negada. Libere o acesso à câmera nas configurações do navegador.');
      } else if (scanError.name === 'NotFoundError') {
        setError('Nenhuma câmera encontrada no dispositivo.');
      } else {
        setError('Erro ao acessar a câmera. Tente novamente.');
      }
      toast.error('Não foi possível acessar a câmera');
    }
  }, [handleBarcodeResult]);

  const handleCaptureAndOCR = async () => {
    if (!videoRef.current) return;
    setProcessing(true);

    try {
      const canvas = document.createElement('canvas');
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas não disponível');

      ctx.drawImage(video, 0, 0);

      // Melhorar contraste para OCR
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const adjusted = gray > 128 ? Math.min(255, (gray - 128) * 1.5 + 128) : Math.max(0, (gray - 64) * 2);
        data[i] = adjusted;
        data[i + 1] = adjusted;
        data[i + 2] = adjusted;
      }
      ctx.putImageData(imageData, 0, 0);

      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Falha ao capturar imagem');

      // Enviar para OCR via Supabase Edge Function
      const base64 = await blobToBase64(blob);
      const { data: result, error } = await supabase.functions.invoke('label-ocr', {
        body: { imageBase64: base64 },
      });

      if (error) throw error;

      const ocrText = result?.text || '';
      if (!ocrText || ocrText.trim().length < 5) {
        toast.error('Não foi possível ler a etiqueta. Tente novamente com melhor iluminação.');
        setProcessing(false);
        return;
      }

      const parsed = parsePackageLabel(ocrText);
      onScanResult(parsed);
      toast.success(`Etiqueta lida! Remetente: ${parsed.sender}`);
      onOpenChange(false);
    } catch (err) {
      console.error('[Scanner] Erro OCR:', err);
      // Fallback: enviar texto direto se OCR indisponível
      toast.warning('OCR indisponível. Use a leitura de código de barras ou digite manualmente.');
      setManualMode(true);
    } finally {
      setProcessing(false);
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(!torchOn);
    } catch {
      toast.warning('Tocha não suportada nesta câmera');
    }
  };

  const handleManualSubmit = () => {
    if (!manualText.trim()) {
      toast.error('Digite o código ou texto da etiqueta');
      return;
    }
    const parsed = parsePackageLabel(manualText);
    onScanResult(parsed);
    setManualText('');
    setManualMode(false);
    onOpenChange(false);
    toast.success(`Etiqueta processada! Remetente: ${parsed.sender}`);
  };

  useEffect(() => {
    if (open) {
      setManualMode(false);
      setManualText('');
      setError(null);
      setProcessing(false);
      if (!manualMode) {
        // Pequeno delay para o video renderizar
        const timer = setTimeout(() => startScanner(), 300);
        return () => clearTimeout(timer);
      }
    } else {
      stopScanner();
    }
    return () => { stopScanner(); };
  }, [open, startScanner, stopScanner, manualMode]);

  // Manter o scanner rodando — auto-restart se parar
  useEffect(() => {
    if (open && scanning && !manualMode && !controlsRef.current && !processing) {
      const timer = setTimeout(() => startScanner(), 500);
      return () => clearTimeout(timer);
    }
  }, [open, scanning, manualMode, processing, startScanner]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) stopScanner(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" />
            Escanear Encomenda
          </DialogTitle>
          <DialogDescription>
            Aponte a câmera para o código de barras ou QR Code da etiqueta.
            Também é possível fotografar a etiqueta para leitura automática.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="outline" onClick={() => { setError(null); startScanner(); }}>
                Tentar novamente
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setError(null); setManualMode(true); }}>
                Digitar manualmente
              </Button>
            </div>
          </div>
        )}

        {!manualMode && !error ? (
          <div className="flex flex-col items-center gap-4">
            {/* Preview da câmera */}
            <div className="relative w-full rounded-xl overflow-hidden border-2 border-border bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-auto max-h-[50vh] object-contain"
              />

              {/* Overlay de mira */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-64 h-40 border-2 border-primary/60 rounded-lg relative">
                  <ScanLine className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 text-primary/50 animate-pulse" />
                  {/* Cantos */}
                  <div className="absolute -top-0.5 -left-0.5 w-4 h-4 border-t-2 border-l-2 border-primary rounded-tl" />
                  <div className="absolute -top-0.5 -right-0.5 w-4 h-4 border-t-2 border-r-2 border-primary rounded-tr" />
                  <div className="absolute -bottom-0.5 -left-0.5 w-4 h-4 border-b-2 border-l-2 border-primary rounded-bl" />
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 border-b-2 border-r-2 border-primary rounded-br" />
                </div>
              </div>

              {/* Status */}
              {processing && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2 text-white">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <p className="text-sm">Processando etiqueta...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Controles */}
            <div className="flex flex-wrap gap-2 justify-center">
              <Button
                type="button"
                size="lg"
                onClick={handleCaptureAndOCR}
                disabled={processing}
                className="gap-2"
              >
                {processing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                Fotografar & Ler Etiqueta
              </Button>

              {hasTorch && (
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  onClick={toggleTorch}
                  className="gap-2"
                >
                  {torchOn ? <Zap className="h-5 w-5 text-yellow-500" /> : <ZapOff className="h-5 w-5" />}
                  {torchOn ? 'Luz Ligada' : 'Luz Desligada'}
                </Button>
              )}

              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={() => { stopScanner(); setManualMode(true); }}
              >
                Digitar Código
              </Button>

              <Button
                type="button"
                size="lg"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Dicas */}
            <div className="text-xs text-muted-foreground text-center space-y-1">
              <p>• Posicione a etiqueta dentro da área de mira</p>
              <p>• Certifique-se de boa iluminação</p>
              <p>• Para câmeras sem foco manual, mantenha a etiqueta a ~15-20cm</p>
            </div>
          </div>
        ) : (
          /* Modo manual */
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Código de barras / QR Code / Texto da etiqueta
              </label>
              <textarea
                className="w-full min-h-[120px] p-3 border rounded-lg bg-background text-sm font-mono"
                placeholder="Cole ou digite o código da etiqueta...&#10;&#10;Ex: MLX123456789BR&#10;Ou texto completo da etiqueta"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleManualSubmit} disabled={!manualText.trim()}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Processar
              </Button>
              <Button variant="outline" onClick={() => { setManualMode(false); setError(null); setTimeout(startScanner, 300); }}>
                Voltar à Câmera
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};