"use client";

import { useCallback, useEffect, useState } from "react";
import { getDb } from "@/hooks/useChunkStorage";
import { uploadRecoverySegments } from "@/lib/upload-client";
import { buildSegmentsFromChunks } from "@/lib/chunk-segmentation";
import { INDEXEDDB } from "@/lib/constants";
import type { ChunkRecord, RecoveryRecord } from "@/types/recording";

export interface RecoveryData {
  gravacaoId: string;
  metadata: RecoveryRecord["metadata"];
  modo: RecoveryRecord["modo"];
  startedAt: number;
  lastChunkAt: number;
  chunkCount: number;
  totalBytes: number;
  estimatedDurationMs: number;
}

interface RecoveryState {
  hasInterruptedRecording: boolean;
  recoveryData: RecoveryData | null;
  isLoading: boolean;
  isConsolidating: boolean;
}

export const useRecovery = () => {
  const [state, setState] = useState<RecoveryState>({
    hasInterruptedRecording: false,
    recoveryData: null,
    isLoading: true,
    isConsolidating: false,
  });

  const syncBackendStatus = useCallback(async (gravacaoId: string, status: "INTERROMPIDA" | "EM_ANDAMENTO") => {
    try {
      await fetch(`/api/gravacoes/${gravacaoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch {
      // Best-effort only: local recovery remains source of truth
    }
  }, []);

  const checkForInterruptedInner = useCallback(async (
    db: Awaited<ReturnType<typeof getDb>>,
    record: RecoveryRecord
  ) => {
    const tx = db.transaction(INDEXEDDB.CHUNKS_STORE, "readonly");
    const idx = tx.store.index("by-gravacao");
    const chunks = (await idx.getAll(record.gravacaoId)) as ChunkRecord[];

    if (chunks.length === 0) {
      // No chunks — clean up stale recovery record
      await db.delete(INDEXEDDB.RECOVERY_STORE, record.gravacaoId);
      setState({
        hasInterruptedRecording: false,
        recoveryData: null,
        isLoading: false,
        isConsolidating: false,
      });
      return;
    }

    const totalBytes = chunks.reduce((sum, c) => sum + c.data.size, 0);
    // Estimate duration: chunkCount * 5s interval
    const estimatedDurationMs = chunks.length * 5000;

    setState({
      hasInterruptedRecording: true,
      recoveryData: {
        gravacaoId: record.gravacaoId,
        metadata: record.metadata,
        modo: record.modo,
        startedAt: record.startedAt,
        lastChunkAt: record.lastChunkAt,
        chunkCount: chunks.length,
        totalBytes,
        estimatedDurationMs,
      },
      isLoading: false,
      isConsolidating: false,
    });

    // Keep backend state consistent with local interrupted detection.
    await syncBackendStatus(record.gravacaoId, "INTERROMPIDA");
  }, [syncBackendStatus]);

  const checkForInterrupted = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true }));
    try {
      const db = await getDb();

      // Get all recovery records
      const allRecovery = (await db.getAll(INDEXEDDB.RECOVERY_STORE)) as RecoveryRecord[];
      const interrupted = allRecovery.find((r) => r.status === "interrupted");

      if (!interrupted) {
        // Also check for "recording" status (browser crashed without marking interrupted)
        const recording = allRecovery.find((r) => r.status === "recording");
        if (recording) {
          // Mark it as interrupted since the app restarted
          await db.put(INDEXEDDB.RECOVERY_STORE, { ...recording, status: "interrupted" });
          return checkForInterruptedInner(db, { ...recording, status: "interrupted" });
        }

        setState({
          hasInterruptedRecording: false,
          recoveryData: null,
          isLoading: false,
          isConsolidating: false,
        });
        return;
      }

      await checkForInterruptedInner(db, interrupted);
    } catch {
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [checkForInterruptedInner]);

  // Retomar: redirect to recording screen to continue
  const retomar = useCallback(async () => {
    if (!state.recoveryData) return null;
    await syncBackendStatus(state.recoveryData.gravacaoId, "EM_ANDAMENTO");
    return state.recoveryData.gravacaoId;
  }, [state.recoveryData, syncBackendStatus]);

  // Finalizar: consolidate chunks and upload
  const finalizar = useCallback(async (): Promise<boolean> => {
    if (!state.recoveryData) return false;

    setState((s) => ({ ...s, isConsolidating: true }));
    const { gravacaoId } = state.recoveryData;

    try {
      const db = await getDb();

      // Get all chunks
      const tx = db.transaction(INDEXEDDB.CHUNKS_STORE, "readonly");
      const idx = tx.store.index("by-gravacao");
      const chunks = (await idx.getAll(gravacaoId)) as ChunkRecord[];

      if (chunks.length === 0) {
        throw new Error("Nenhum chunk encontrado para consolidar.");
      }

      const segments = buildSegmentsFromChunks(chunks);
      if (segments.length === 0) {
        throw new Error("Nenhum segmento válido encontrado para envio.");
      }

      // Upload with estimated duration
      const estimatedDurationSec = chunks.length * 5;
      await uploadRecoverySegments(gravacaoId, segments, {
        duracao: estimatedDurationSec,
      });

      // Clean up IndexedDB
      const deleteTx = db.transaction(INDEXEDDB.CHUNKS_STORE, "readwrite");
      const deleteIdx = deleteTx.store.index("by-gravacao");
      let cursor = await deleteIdx.openCursor(gravacaoId);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await deleteTx.done;

      // Remove recovery record
      await db.delete(INDEXEDDB.RECOVERY_STORE, gravacaoId);

      setState({
        hasInterruptedRecording: false,
        recoveryData: null,
        isLoading: false,
        isConsolidating: false,
      });

      return true;
    } catch {
      setState((s) => ({ ...s, isConsolidating: false }));
      return false;
    }
  }, [state.recoveryData]);

  const dismiss = useCallback(async () => {
    if (!state.recoveryData) return;
    try {
      const db = await getDb();
      // Clean up chunks and recovery record
      const deleteTx = db.transaction(INDEXEDDB.CHUNKS_STORE, "readwrite");
      const deleteIdx = deleteTx.store.index("by-gravacao");
      let cursor = await deleteIdx.openCursor(state.recoveryData.gravacaoId);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await deleteTx.done;
      await db.delete(INDEXEDDB.RECOVERY_STORE, state.recoveryData.gravacaoId);

      setState({
        hasInterruptedRecording: false,
        recoveryData: null,
        isLoading: false,
        isConsolidating: false,
      });
    } catch {
      // silent
    }
  }, [state.recoveryData]);

  useEffect(() => {
    checkForInterrupted();
  }, [checkForInterrupted]);

  return {
    ...state,
    retomar,
    finalizar,
    dismiss,
    refresh: checkForInterrupted,
  };
};
