import * as React from 'react';
import { createPortal } from 'react-dom';
import { ToastItem, type Toast } from './toast';
import { toastStore } from '@/lib/toast';

export function Toaster() {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  React.useEffect(() => {
    return toastStore.subscribe(setToasts);
  }, []);

  const handleDismiss = React.useCallback((id: string) => {
    toastStore.dismiss(id);
  }, []);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={handleDismiss} />
      ))}
    </div>,
    document.body,
  );
}
