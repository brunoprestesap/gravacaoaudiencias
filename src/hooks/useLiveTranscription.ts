"use client";

import { useRef, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/useToast";
import type { SpeechSegment } from "@/hooks/useSpeechRecognition";

/**
 * Gerencia o envio incremental de segmentos de transcrição ao servidor.
 * Batcha segmentos finais, envia com retry e agenda flush periódico quando ativo.
 */
export function useLiveTranscription(
  gravacaoId: string,
  finalSegments: SpeechSegment[],
  active: boolean
) {
  const toast = useToast();
  const pendingSpeechSegmentsRef = useRef<SpeechSegment[]>([]);
  const queuedSpeechIdsRef = useRef<Set<string>>(new Set());
  const flushRetriesRef = useRef(0);

  const flush = useCallback(
    async ({ force = false, isFinal = false }: { force?: boolean; isFinal?: boolean } = {}) => {
      if (pendingSpeechSegmentsRef.current.length === 0 && !isFinal) {
        flushRetriesRef.current = 0;
        return true;
      }

      if (!force && typeof navigator !== "undefined" && !navigator.onLine) {
        return false;
      }

      const batch = [...pendingSpeechSegmentsRef.current];
      try {
        const response = await fetch(`/api/gravacoes/${gravacaoId}/transcricao`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isFinal,
            segments: batch.map((segment) => ({
              id: segment.id,
              text: segment.text,
              offsetMs: segment.offsetMs,
              createdAt: segment.createdAt,
              speakerId: segment.speakerId,
              role: segment.role,
              confidence: segment.confidence,
              voiceFeatures: segment.voiceFeatures,
            })),
          }),
        });

        if (!response.ok) {
          throw new Error("Falha ao persistir transcrição");
        }

        const sentIds = new Set(batch.map((segment) => segment.id));
        pendingSpeechSegmentsRef.current = pendingSpeechSegmentsRef.current.filter(
          (segment) => !sentIds.has(segment.id)
        );
        flushRetriesRef.current = 0;
        return true;
      } catch {
        flushRetriesRef.current += 1;
        if (flushRetriesRef.current === 1 || flushRetriesRef.current % 3 === 0) {
          toast.warning(
            "A transcrição em tempo real está offline temporariamente. Tentando reconectar."
          );
        }
        return false;
      }
    },
    [gravacaoId, toast]
  );

  // Enfileira novos segmentos finais
  useEffect(() => {
    for (const segment of finalSegments) {
      if (queuedSpeechIdsRef.current.has(segment.id)) {
        continue;
      }
      queuedSpeechIdsRef.current.add(segment.id);
      pendingSpeechSegmentsRef.current.push(segment);
    }
  }, [finalSegments]);

  // Flush periódico enquanto gravação ativa
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      void flush({ force: false });
    }, 4000);
    return () => clearInterval(interval);
  }, [active, flush]);

  return { flush };
}
