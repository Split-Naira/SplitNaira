import { ToastVariant } from "@/components/toast-provider";

type NotifyListener = (message: string, variant: ToastVariant, duration?: number) => void;

let listener: NotifyListener | null = null;

/**
 * Internal function to connect the ToastProvider to the notification system.
 */
export const _setNotifyListener = (l: NotifyListener | null) => {
  listener = l;
};

/**
 * Global notification API.
 * Can be used inside or outside of React components.
 */
export const notify = {
  success: (message: string, duration?: number) => {
    listener?.(message, "success", duration);
  },
  error: (message: string, duration?: number) => {
    listener?.(message, "error", duration);
  },
  info: (message: string, duration?: number) => {
    listener?.(message, "info", duration);
  },
  warning: (message: string, duration?: number) => {
    listener?.(message, "warning", duration);
  },
};
