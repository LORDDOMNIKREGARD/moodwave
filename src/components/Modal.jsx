import { useEffect, useRef } from 'react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import Icon from './Icon.jsx';

/** Native <dialog>: focus is trapped, Escape closes, the page behind is inert. Entry animation is CSS (transform and opacity). */
export default function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d.open) d.showModal();
    const onCancel = (e) => { e.preventDefault(); onClose(); };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, [onClose]);
  return (
    <dialog
      ref={ref} className="modal" aria-labelledby="modal-title"
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon icon={Cancel01Icon} size={17} /></button>
      </div>
      {children}
    </dialog>
  );
}
