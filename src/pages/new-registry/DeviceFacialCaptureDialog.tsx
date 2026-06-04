import { Dispatch, SetStateAction } from 'react';
import { Loader2, ScanFace, Wifi, WifiOff } from 'lucide-react';
import { Device } from '@/types';
import { DeviceCaptureStatus } from '@/components/DeviceCaptureStatus';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface DeviceFacialCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facialDevices: Device[];
  selectedFacialDeviceId: string;
  setSelectedFacialDeviceId: Dispatch<SetStateAction<string>>;
  status: string;
  step?: import('@/lib/device-capture').CaptureStep;
  progress: number;
  loading: boolean;
  onCancelCapture: () => void;
  onCapture: () => void;
}

export function DeviceFacialCaptureDialog({
  open,
  onOpenChange,
  facialDevices,
  selectedFacialDeviceId,
  setSelectedFacialDeviceId,
  status,
  step,
  progress,
  loading,
  onCancelCapture,
  onCapture,
}: DeviceFacialCaptureDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanFace className="h-5 w-5 text-primary" />
            Captura Facial pelo Dispositivo
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Dispositivo Facial</Label>
            <Select value={selectedFacialDeviceId} onValueChange={setSelectedFacialDeviceId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o dispositivo..." />
              </SelectTrigger>
              <SelectContent>
                {facialDevices.map(device => (
                  <SelectItem key={device.id} value={device.id}>
                    <div className="flex items-center gap-2">
                      {device.status === 'online' ? <Wifi className="h-3 w-3 text-green-500" /> : <WifiOff className="h-3 w-3 text-destructive" />}
                      {device.name} - {device.location}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DeviceCaptureStatus
            status={status}
            step={step}
            progress={progress}
            loading={loading}
            onCancel={onCancelCapture}
          />

          <div className="flex gap-2">
            <Button
              onClick={onCapture}
              disabled={!selectedFacialDeviceId || loading}
              className="flex-1 gap-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanFace className="h-4 w-4" />}
              Capturar Foto
            </Button>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
