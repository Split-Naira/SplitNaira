"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastVariant = "error" | "warning" | "success" | "info";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number; // ms — 0 means sticky
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (message: string, variant?: ToastVariant, duration?: number) => void;
  dismiss: (id: string) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "info", duration = 5000) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const newToast: Toast = { id, message, variant, duration };
      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
    },
    [dismiss],
  );

  // Sync with global notification API
  useEffect(() => {
    import("@/lib/notification").then((mod) => {
      mod._setNotifyListener(toast);
    });
    return () => {
      import("@/lib/notification").then((mod) => {
        mod._setNotifyListener(null);
      });
    };
  }, [toast]);

  // Cleanup on unmount
  useEffect(() => {
    const t = timers.current;
    return () => {
      t.forEach(clearTimeout);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ─── Variant styles ───────────────────────────────────────────────────────────

const variantStyles: Record<ToastVariant, string> = {
  error: "bg-red-600 text-white border-red-700",
  warning: "bg-amber-500 text-white border-amber-600",
  success: "bg-emerald-600 text-white border-emerald-700",
  info: "bg-slate-800 text-white border-slate-700",
};

const variantIcons: Record<ToastVariant, string> = {
  error: "✕",
  warning: "⚠",
  success: "✓",
  info: "ℹ",
};

// ─── Container ────────────────────────────────────────────────────────────────

function ToastContainer({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="assertive"
      aria-atomic="false"
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-full max-w-sm pointer-events-none"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={[
            "flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg",
            "pointer-events-auto animate-slide-in",
            variantStyles[t.variant],
          ].join(" ")}
        >
          <span className="text-base leading-none mt-0.5 shrink-0 font-bold">
            {variantIcons[t.variant]}
          </span>
          <p className="flex-1 text-sm leading-snug">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            className="shrink-0 opacity-70 hover:opacity-100 transition-opacity text-base leading-none"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
