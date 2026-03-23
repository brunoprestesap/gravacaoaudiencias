import { useCallback } from "react";
import { useToastStore } from "@/stores/toast-store";
import { TOAST_DURATIONS } from "@/lib/constants";

export const useToast = () => {
  const { addToast, removeToast } = useToastStore();

  const toast = useCallback(
    (type: "success" | "info" | "warning" | "error", message: string) => {
      const id = addToast(type, message);
      const duration = TOAST_DURATIONS[type];
      if (duration > 0) {
        setTimeout(() => removeToast(id), duration);
      }
      return id;
    },
    [addToast, removeToast]
  );

  return {
    success: (msg: string) => toast("success", msg),
    info: (msg: string) => toast("info", msg),
    warning: (msg: string) => toast("warning", msg),
    error: (msg: string) => toast("error", msg),
    dismiss: removeToast,
  };
};
