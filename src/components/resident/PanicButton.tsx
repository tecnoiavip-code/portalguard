import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Shield, ShieldCheck, Loader2 } from 'lucide-react';

const db = supabase as any;
const HOLD_MS = 2000;
const AUTO_SEND_S = 3;
const CANCEL_S = 10;

const locations = [
  { id: 'apartment', label: 'Em casa' },
  { id: 'garage', label: 'Garagem / Portão' },
  { id: 'entrance', label: 'Chegando' },
];

type Step = 'idle' | 'choose' | 'sending' | 'sent' | 'error';

export const PanicButton = () => {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<Step>('idle');
  const [countdown, setCountdown] = useState(AUTO_SEND_S);
  const [cancelLeft, setCancelLeft] = useState(CANCEL_S);
  const [alertId, setAlertId] = useState<string | null>(null);
  const [lastLocation, setLastLocation] = useState('other');
  const holdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sentRef = useRef(false);

  const clearTimer = () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };

  const reset = () => {
    clearTimer();
    if (holdRef.current) clearInterval(holdRef.current);
    setProgress(0); setStep('idle'); setAlertId(null); sentRef.current = false;
    setCountdown(AUTO_SEND_S); setCancelLeft(CANCEL_S);
  };

  const send = async (location: string) => {
    if (sentRef.current) return;
    sentRef.current = true;
    setLastLocation(location);
    clearTimer();
    setStep('sending');
    try {
      const { data, error } = await db.rpc('trigger_panic_alert', { _location: location });
      if (error || !data) throw error || new Error('Alerta sem confirmação');
      setAlertId(data as string);
      setStep('sent');
      if (navigator.vibrate) navigator.vibrate(80);
      setCancelLeft(CANCEL_S);
      timerRef.current = setInterval(() => {
        setCancelLeft(s => { if (s <= 1) { clearTimer(); return 0; } return s - 1; });
      }, 1000);
    } catch (error) {
      console.error('Falha ao comunicar a guarita:', error);
      sentRef.current = false;
      setStep('error');
    }
  };

  const startHold = () => {
    if (step !== 'idle') return;
    const start = Date.now();
    holdRef.current = setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / HOLD_MS) * 100);
      setProgress(p);
      if (p >= 100) {
        if (holdRef.current) clearInterval(holdRef.current);
        if (navigator.vibrate) navigator.vibrate(40);
        setStep('choose');
        setCountdown(AUTO_SEND_S);
        timerRef.current = setInterval(() => {
          setCountdown(c => {
            if (c <= 1) { send('other'); return 0; }
            return c - 1;
          });
        }, 1000);
      }
    }, 50);
  };

  const endHold = () => {
    if (step === 'idle') { if (holdRef.current) clearInterval(holdRef.current); setProgress(0); }
  };

  const cancelAlert = async () => {
    if (alertId) await db.rpc('cancel_panic_alert', { _id: alertId });
    reset();
    setOpen(false);
  };

  useEffect(() => () => { clearTimer(); if (holdRef.current) clearInterval(holdRef.current); }, []);

  return (
    <>
      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => { reset(); setOpen(true); }} aria-label="Segurança">
        <Shield className="h-5 w-5" />
      </Button>
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent
          className="max-w-sm [&>button]:hidden"
          onEscapeKeyDown={e => e.preventDefault()}
          onPointerDownOutside={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
        >
          <DialogTitle className="text-center">Segurança</DialogTitle>
          <DialogDescription className="text-center">
            {step === 'idle' && 'Segure o botão por 2 segundos para chamar a guarita em modo discreto.'}
            {step === 'choose' && `Onde você está? Envio automático em ${countdown}s.`}
            {step === 'sending' && 'Enviando...'}
            {step === 'sent' && 'Guarita comunicada em modo de segurança.'}
            {step === 'error' && 'Não foi possível comunicar. Tente novamente ou use o interfone.'}
          </DialogDescription>

          {step === 'idle' && (
            <div className="flex flex-col items-center gap-4 py-2">
              <button
                type="button"
                onPointerDown={startHold}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onContextMenu={e => e.preventDefault()}
                className="relative h-32 w-32 rounded-full bg-primary text-primary-foreground flex items-center justify-center select-none touch-none overflow-hidden"
              >
                <span className="absolute bottom-0 left-0 right-0 bg-primary-foreground/25" style={{ height: `${progress}%` }} />
                <Shield className="h-12 w-12 relative" />
              </button>
            </div>
          )}

          {step === 'choose' && (
            <div className="grid gap-3 py-2">
              {locations.map(l => (
                <Button key={l.id} variant="outline" className="h-12" onClick={() => send(l.id)}>{l.label}</Button>
              ))}
            </div>
          )}

          {step === 'sending' && <div className="flex justify-center py-6"><Loader2 className="h-8 w-8 animate-spin" /></div>}

          {step === 'error' && (
            <Button variant="outline" className="w-full" onClick={() => send(lastLocation)}>Tentar novamente</Button>
          )}

          {step === 'sent' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <ShieldCheck className="h-12 w-12 text-muted-foreground" />
              {cancelLeft > 0 && (
                <Button variant="outline" onClick={cancelAlert}>Foi engano ({cancelLeft}s)</Button>
              )}
            </div>
          )}

          <Button variant="destructive" onClick={() => { reset(); setOpen(false); }} className="w-full">
            {step === 'sent' || step === 'error' ? 'Fechar' : 'Cancelar'}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
};
