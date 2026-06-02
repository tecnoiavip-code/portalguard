/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

declare module 'virtual:pwa-register/react';
declare module 'qrcode.react';
declare module 'jspdf';
declare module 'jspdf-autotable';
declare module 'pdfjs-dist';

interface ImportMetaEnv {
  readonly VITE_RESIDENT_EXTENDED_REALTIME_ENABLED?: string;
}
