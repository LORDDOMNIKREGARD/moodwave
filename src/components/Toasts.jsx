import SwipeToast from './reactbits/SwipeToast.jsx';
import { useStore } from '../app/useStore.js';
import { dismissToast } from '../app/store.js';

/** Stacked toasts. Each one burns down a thin fuse and can be swiped away. */
export default function Toasts() {
  const s = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {s.toasts.map((t) => (
        <SwipeToast
          key={t.id} inline title={t.message} duration={t.ms} width={380} radius={14} onClose={() => dismissToast(t.id)}
          background="var(--cta-fill)" color="var(--cta-ink)" fuseColor={t.kind === 'error' ? 'var(--bad)' : 'var(--accent)'}
        />
      ))}
    </div>
  );
}
