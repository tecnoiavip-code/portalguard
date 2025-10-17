import { QRCodeSVG } from 'qrcode.react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Share2 } from 'lucide-react';
import { AccessEntry } from '@/types';

interface VisitorQRCodeProps {
  entry: AccessEntry;
  isOpen: boolean;
  onClose: () => void;
}

export function VisitorQRCode({ entry, isOpen, onClose }: VisitorQRCodeProps) {
  const qrData = JSON.stringify({
    id: entry.id,
    visitorName: entry.visitorName,
    visitorDocument: entry.visitorDocument,
    apartment: entry.apartment,
    entryTime: entry.entryTime,
    purpose: entry.purpose,
  });

  const downloadQRCode = () => {
    const svg = document.getElementById('visitor-qr-code');
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      const pngFile = canvas.toDataURL('image/png');

      const downloadLink = document.createElement('a');
      downloadLink.download = `qrcode-${entry.visitorName}-${entry.id}.png`;
      downloadLink.href = pngFile;
      downloadLink.click();
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  };

  const shareQRCode = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'QR Code - Acesso Visitante',
          text: `QR Code para ${entry.visitorName} - Apartamento ${entry.apartment}`,
        });
      } catch (error) {
        console.error('Erro ao compartilhar:', error);
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>QR Code - Acesso Visitante</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center space-y-4 py-4">
          <div className="bg-white p-4 rounded-lg">
            <QRCodeSVG
              id="visitor-qr-code"
              value={qrData}
              size={256}
              level="H"
              includeMargin={true}
            />
          </div>
          <div className="text-center space-y-1">
            <p className="font-semibold">{entry.visitorName}</p>
            <p className="text-sm text-muted-foreground">Apartamento {entry.apartment}</p>
            <p className="text-sm text-muted-foreground">{entry.residentName}</p>
          </div>
          <div className="flex gap-2 w-full">
            <Button onClick={downloadQRCode} className="flex-1">
              <Download className="h-4 w-4 mr-2" />
              Baixar
            </Button>
            {navigator.share && (
              <Button onClick={shareQRCode} variant="outline" className="flex-1">
                <Share2 className="h-4 w-4 mr-2" />
                Compartilhar
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
