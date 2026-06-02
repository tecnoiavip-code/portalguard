import { ChangeEvent, Dispatch, SetStateAction } from 'react';
import { Camera, ScanFace, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Device } from '@/types';

import { NewRegistryFormData } from '../registry-form';

interface PhotoSectionProps {
  formData: NewRegistryFormData;
  setFormData: Dispatch<SetStateAction<NewRegistryFormData>>;
  onStartCamera: () => void;
  facialDevices: Device[];
  onOpenDeviceFacialDialog: () => void;
  onPhotoUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function PhotoSection({
  formData,
  setFormData,
  onStartCamera,
  facialDevices,
  onOpenDeviceFacialDialog,
  onPhotoUpload,
}: PhotoSectionProps) {
  return (
    <div className="space-y-2 flex items-center gap-4">
      <div>
        {formData.photo ? (
          <img src={formData.photo} alt="Foto" className="w-24 h-24 rounded-full object-cover border-2 border-primary" />
        ) : (
          <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            Sem foto
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label>Foto do Visitante</Label>
        <div className="flex gap-2 flex-wrap">
          <Button type="button" size="sm" variant="outline" onClick={onStartCamera}>
            <Camera className="h-4 w-4 mr-2" />
            Webcam
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById('photoUpload')?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Carregar
          </Button>
          {facialDevices.length > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={onOpenDeviceFacialDialog} className="gap-1">
              <ScanFace className="h-4 w-4" />
              Dispositivo
            </Button>
          )}
          {formData.photo && (
            <Button type="button" size="sm" variant="destructive" onClick={() => setFormData({ ...formData, photo: '' })}>
              <Trash2 className="h-4 w-4 mr-2" />
              Remover
            </Button>
          )}
        </div>
      </div>
      <input id="photoUpload" type="file" accept="image/*" className="hidden" onChange={onPhotoUpload} />
    </div>
  );
}
