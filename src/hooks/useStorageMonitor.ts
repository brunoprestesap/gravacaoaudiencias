"use client";

import { useEffect } from "react";
import { STORAGE_MONITOR } from "@/lib/constants";

/**
 * Enquanto `active`, pede armazenamento persistente (sem isso, o navegador pode apagar
 * os chunks quando falta espaço) e avisa uma vez sempre que o espaço livre ficar baixo.
 */
export function useStorageMonitor(active: boolean, onLowStorage: () => void) {
  useEffect(() => {
    const storage = navigator.storage;
    if (!active || !storage) return;

    let cancelled = false;
    let warned = false;

    void storage.persist?.().then(
      (granted) => {
        if (!granted) {
          console.warn("[gravacao] navegador não concedeu armazenamento persistente.");
        }
      },
      () => {}
    );

    const check = async () => {
      try {
        const { quota, usage } = await storage.estimate();
        if (cancelled || quota === undefined) return;
        const isLow = quota - (usage ?? 0) < STORAGE_MONITOR.LOW_FREE_BYTES;
        if (isLow && !warned) onLowStorage();
        warned = isLow;
      } catch {
        // Estimativa indisponível: a falha real ainda aparece ao salvar o chunk.
      }
    };

    void check();
    const intervalId = setInterval(check, STORAGE_MONITOR.CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [active, onLowStorage]);
}
