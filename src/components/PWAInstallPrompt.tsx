import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const PWAInstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches 
      || (window.navigator as any).standalone === true;
    setIsStandalone(standalone);

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIOS(ios);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      const dismissed = localStorage.getItem('pwa-install-dismissed');
      if (!dismissed) setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Show iOS banner if not installed and not dismissed
    if (ios && !standalone) {
      const dismissed = localStorage.getItem('pwa-install-dismissed');
      if (!dismissed) setShowBanner(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (isStandalone || !showBanner) return null;

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setShowBanner(false);
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  return (
    <div className="fixed bottom-16 left-2 right-2 z-50 bg-primary text-primary-foreground rounded-xl p-4 shadow-lg animate-in slide-in-from-bottom-4">
      <button onClick={handleDismiss} className="absolute top-2 right-2 opacity-60 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-3">
        <div className="bg-primary-foreground/20 p-2 rounded-lg">
          <Download className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm">Instale o App</p>
          {isIOS ? (
            <p className="text-xs opacity-80">
              Toque em <span className="font-bold">Compartilhar</span> → <span className="font-bold">Adicionar à Tela Inicial</span>
            </p>
          ) : (
            <p className="text-xs opacity-80">Acesse rápido pela tela inicial</p>
          )}
        </div>
        {!isIOS && (
          <Button size="sm" variant="secondary" onClick={handleInstall}>
            Instalar
          </Button>
        )}
      </div>
    </div>
  );
};

export default PWAInstallPrompt;
