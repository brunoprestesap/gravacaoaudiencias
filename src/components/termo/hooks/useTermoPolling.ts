"use client";

import { useEffect, useState } from "react";
import type { TermoSnapshot, TermoStatus } from "../types";

const POLL_INTERVAL_MS = 4000;

interface PollPayload {
  termo: TermoSnapshot;
}

async function fetchTermo(gravacaoId: string): Promise<TermoSnapshot | null> {
  try {
    const res = await fetch(`/api/gravacoes/${gravacaoId}/termo`);
    if (!res.ok) return null;
    const json = (await res.json()) as PollPayload;
    return json.termo;
  } catch {
    return null;
  }
}

export interface UseTermoPollingResult {
  snapshot: TermoSnapshot;
  setSnapshot: (next: TermoSnapshot) => void;
}

export function useTermoPolling(
  gravacaoId: string,
  initial: TermoSnapshot
): UseTermoPollingResult {
  const [snapshot, setSnapshot] = useState<TermoSnapshot>(initial);

  useEffect(() => {
    if (snapshot.status !== ("PROCESSANDO" satisfies TermoStatus)) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      const next = await fetchTermo(gravacaoId);
      if (cancelled || !next) return;
      setSnapshot(next);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [snapshot.status, gravacaoId]);

  return { snapshot, setSnapshot };
}
