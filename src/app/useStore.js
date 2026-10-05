import { useSyncExternalStore } from 'react';
import { S, subscribe, getVersion } from './store.js';

/** Re-render on every store change and hand back the (mutable) state object. */
export function useStore() {
  useSyncExternalStore(subscribe, getVersion);
  return S;
}

export function usePrefersDark() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
}

export function useReducedMotionPref() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
}
