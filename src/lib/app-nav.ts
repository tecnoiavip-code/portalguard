import { useEffect, useRef } from 'react';

export interface AppNavTarget {
  section: string;
  id?: string | null;
  action?: string | null;
}

type AppNavListener = (target: AppNavTarget) => void;

let pending: AppNavTarget | null = null;
const listeners = new Set<AppNavListener>();

export const navigateInApp = (target: AppNavTarget): void => {
  pending = target;
  listeners.forEach((l) => l(target));
};

export const consumeAppNav = (section: string): AppNavTarget | null => {
  if (pending && pending.section === section) {
    const target = pending;
    pending = null;
    return target;
  }
  return null;
};

export const onAppNav = (listener: AppNavListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useAppNav = (section: string, handler: (target: AppNavTarget) => void): void => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const target = consumeAppNav(section);
    if (target) handlerRef.current(target);

    return onAppNav((nav) => {
      if (nav.section !== section) return;
      if (pending && pending.section === section) pending = null;
      handlerRef.current(nav);
    });
  }, [section]);
};