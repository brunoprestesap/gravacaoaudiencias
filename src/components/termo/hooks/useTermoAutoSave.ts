"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 1000;
const SAVED_INDICATOR_MS = 1500;

export type AutoSaveState = "idle" | "saving" | "saved";

export interface UseTermoAutoSaveResult {
  saveState: AutoSaveState;
  scheduleSave: (texto: string) => void;
}

async function patchTermo(gravacaoId: string, texto: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/gravacoes/${gravacaoId}/termo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function useTermoAutoSave(gravacaoId: string): UseTermoAutoSaveResult {
  const [saveState, setSaveState] = useState<AutoSaveState>("idle");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedIndicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (savedIndicatorTimer.current) clearTimeout(savedIndicatorTimer.current);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const scheduleSave = useCallback(
    (texto: string) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      setSaveState("saving");
      debounceTimer.current = setTimeout(async () => {
        const ok = await patchTermo(gravacaoId, texto);
        if (!ok) {
          setSaveState("idle");
          return;
        }
        setSaveState("saved");
        savedIndicatorTimer.current = setTimeout(
          () => setSaveState("idle"),
          SAVED_INDICATOR_MS
        );
      }, DEBOUNCE_MS);
    },
    [gravacaoId]
  );

  return { saveState, scheduleSave };
}
