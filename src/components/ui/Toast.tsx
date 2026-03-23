"use client";

import { useToastStore } from "@/stores/toast-store";

const typeStyles = {
  success: "bg-green-700",
  info: "bg-blue-700",
  warning: "bg-yellow-600",
  error: "bg-red-700",
} as const;

export const ToastContainer = () => {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`animate-slide-in-right flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-white shadow-dropdown ${typeStyles[toast.type]}`}
        >
          <span className="flex-1">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="ml-2 text-white/70 hover:text-white"
            aria-label="Fechar"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
};
