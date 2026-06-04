import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { capturePhotoFromDevice, CaptureStep } from '@/lib/device-capture';
import { Device, Resident } from '@/types';

import { NewRegistryFormData } from './registry-form';

interface UseRegistryPhotoCaptureParams {
  devices: Device[];
  residents: Resident[];
  formData: NewRegistryFormData;
  setFormData: Dispatch<SetStateAction<NewRegistryFormData>>;
}

export const useRegistryPhotoCapture = ({
  devices,
  residents,
  formData,
  setFormData,
}: UseRegistryPhotoCaptureParams) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureAbortControllerRef = useRef<AbortController | null>(null);
  const [showCameraDialog, setShowCameraDialog] = useState(false);
  const [deviceCaptureLoading, setDeviceCaptureLoading] = useState(false);
  const [deviceCaptureStatus, setDeviceCaptureStatus] = useState('');
  const [deviceCaptureStep, setDeviceCaptureStep] = useState<CaptureStep | undefined>();
  const [deviceCaptureProgress, setDeviceCaptureProgress] = useState(0);
  const [selectedFacialDeviceId, setSelectedFacialDeviceId] = useState('');
  const [showDeviceFacialDialog, setShowDeviceFacialDialog] = useState(false);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      captureAbortControllerRef.current?.abort();
    };
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });

      streamRef.current = mediaStream;
      setShowCameraDialog(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      }, 200);
    } catch (error) {
      toast.error('Não foi possível acessar a câmera');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setShowCameraDialog(false);
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const context = canvasRef.current.getContext('2d');
    if (!context) return;

    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    context.drawImage(videoRef.current, 0, 0);
    const photoData = canvasRef.current.toDataURL('image/jpeg');
    setFormData(prev => ({ ...prev, photo: photoData }));
    stopCamera();
    toast.success('Foto capturada com sucesso!');
  }, [setFormData, stopCamera]);

  const handlePhotoUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, photo: reader.result as string }));
        toast.success('Foto carregada com sucesso!');
      };
      reader.readAsDataURL(file);
    },
    [setFormData]
  );

  const openDeviceFacialDialog = useCallback(() => {
    setShowDeviceFacialDialog(true);
  }, []);

  const cancelDeviceCapture = useCallback(() => {
    captureAbortControllerRef.current?.abort();
  }, []);

  const handleDeviceCapture = useCallback(async () => {
    const device = devices.find(item => item.id === selectedFacialDeviceId);
    if (!device) {
      toast.error('Selecione um dispositivo facial.');
      return;
    }

    const abortController = new AbortController();
    captureAbortControllerRef.current = abortController;
    setDeviceCaptureLoading(true);
    setDeviceCaptureStatus('Iniciando...');
    setDeviceCaptureStep('preparing');
    setDeviceCaptureProgress(5);

    try {
      const resident = residents.find(item => item.id === formData.residentId);
      const personInfo = formData.visitorName && formData.visitorDocument
        ? {
            name: formData.visitorName,
            apartment: resident?.apartment,
            document: formData.visitorDocument,
            identifier: `sp-${formData.visitorDocument}`,
            registration: formData.visitorDocument,
          }
        : undefined;

      const photo = await capturePhotoFromDevice(
        device,
        (message, step, progress) => {
          setDeviceCaptureStatus(message);
          if (step) setDeviceCaptureStep(step);
          if (progress !== undefined) setDeviceCaptureProgress(progress);
        },
        abortController.signal,
        personInfo
      );

      if (photo) {
        setFormData(prev => ({ ...prev, photo }));
        setShowDeviceFacialDialog(false);
        setDeviceCaptureStatus('');
        setDeviceCaptureStep(undefined);
        setDeviceCaptureProgress(0);
        toast.success('Foto capturada pelo dispositivo!');
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return;

      const isNetworkError =
        error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError');
      toast.error(isNetworkError ? 'Não foi possível conectar ao dispositivo.' : `Erro: ${error.message}`);
    } finally {
      setDeviceCaptureLoading(false);
      captureAbortControllerRef.current = null;
    }
  }, [devices, formData.residentId, formData.visitorDocument, formData.visitorName, residents, selectedFacialDeviceId, setFormData]);

  return {
    videoRef,
    canvasRef,
    showCameraDialog,
    startCamera,
    stopCamera,
    capturePhoto,
    handlePhotoUpload,
    showDeviceFacialDialog,
    setShowDeviceFacialDialog,
    selectedFacialDeviceId,
    setSelectedFacialDeviceId,
    deviceCaptureStatus,
    deviceCaptureStep,
    deviceCaptureProgress,
    deviceCaptureLoading,
    openDeviceFacialDialog,
    cancelDeviceCapture,
    handleDeviceCapture,
  };
};
