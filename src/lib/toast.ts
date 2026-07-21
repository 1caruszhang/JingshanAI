import type { Toast, ToastType } from '@/components/ui/toast';

let idCounter = 0;

class ToastStore {
  private toasts: Toast[] = [];
  private listeners = new Set<(toasts: Toast[]) => void>();

  private notify() {
    this.listeners.forEach((listener) => listener([...this.toasts]));
  }

  subscribe(listener: (toasts: Toast[]) => void) {
    this.listeners.add(listener);
    listener([...this.toasts]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  add(toast: Omit<Toast, 'id'>) {
    const id = `${++idCounter}`;
    this.toasts = [{ ...toast, id }, ...this.toasts];
    this.notify();
    return id;
  }

  dismiss(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }

  dismissAll() {
    this.toasts = [];
    this.notify();
  }
}

export const toastStore = new ToastStore();

function createTypedToast(type: ToastType) {
  return (title: string, description?: string, duration?: number) =>
    toastStore.add({ type, title, description, duration });
}

export const toast = {
  success: createTypedToast('success'),
  error: createTypedToast('error'),
  info: createTypedToast('info'),
  warning: createTypedToast('warning'),
  custom: (toast: Omit<Toast, 'id'>) => toastStore.add(toast),
  dismiss: (id: string) => toastStore.dismiss(id),
  dismissAll: () => toastStore.dismissAll(),
};
