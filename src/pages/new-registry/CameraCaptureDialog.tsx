import { RefObject } from 'react';
import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface CameraCaptureDialogProps {
  open: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onClose: () => void;
  onCapture: () => void;
}

export function CameraCaptureDialog({
  open,
  videoRef,
  canvasRef,
  onClose,
  onCapture,
}: CameraCaptureDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Capturar Foto do Visitante
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative rounded-lg overflow-hidden border-2 border-primary/20 bg-black">
            <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg" />
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <div className="flex gap-3">
            <Button type="button" onClick={onCapture} className="flex-1 gap-2">
              <Camera className="h-4 w-4" />
              Capturar Foto
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
