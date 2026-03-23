"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openDB, IDBPDatabase } from "idb";
import { INDEXEDDB } from "@/lib/constants";
import type { ChunkRecord, RecoveryRecord, ProcessMetadata, ModoGravacao } from "@/types/recording";

interface ChunkStorageState {
  chunkCount: number;
  totalBytes: number;
  lastSavedAt: number | null;
  error: string | null;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getDb = async (): Promise<IDBPDatabase> => {
  return openDB(INDEXEDDB.DB_NAME, INDEXEDDB.DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(INDEXEDDB.CHUNKS_STORE)) {
        const store = db.createObjectStore(INDEXEDDB.CHUNKS_STORE, { keyPath: "id" });
        store.createIndex("by-gravacao", "gravacaoId");
      }
      if (!db.objectStoreNames.contains(INDEXEDDB.RECOVERY_STORE)) {
        db.createObjectStore(INDEXEDDB.RECOVERY_STORE, { keyPath: "gravacaoId" });
      }
    },
  });
};

export { getDb };

export const useChunkStorage = (gravacaoId: string) => {
  const [state, setState] = useState<ChunkStorageState>({
    chunkCount: 0,
    totalBytes: 0,
    lastSavedAt: null,
    error: null,
  });
  const dbRef = useRef<IDBPDatabase | null>(null);
  const chunkIndexRef = useRef(0);
  const initializedRef = useRef(false);

  // Load existing chunks from IndexedDB on mount (critical for recovery)
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const init = async () => {
      try {
        const db = await getDb();
        dbRef.current = db;
        const tx = db.transaction(INDEXEDDB.CHUNKS_STORE, "readonly");
        const idx = tx.store.index("by-gravacao");
        const existingChunks = (await idx.getAll(gravacaoId)) as ChunkRecord[];

        if (existingChunks.length > 0) {
          const maxIndex = Math.max(...existingChunks.map((c) => c.chunkIndex));
          const totalBytes = existingChunks.reduce((sum, c) => sum + c.data.size, 0);
          const lastTimestamp = Math.max(...existingChunks.map((c) => c.timestamp));

          chunkIndexRef.current = maxIndex + 1;
          setState({
            chunkCount: existingChunks.length,
            totalBytes,
            lastSavedAt: lastTimestamp,
            error: null,
          });
        }
      } catch {
        // Silent — will initialize on first saveChunk
      }
    };

    init();
  }, [gravacaoId]);

  const ensureDb = useCallback(async () => {
    if (!dbRef.current) {
      dbRef.current = await getDb();
    }
    return dbRef.current;
  }, []);

  const saveChunk = useCallback(
    async (blob: Blob) => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const db = await ensureDb();
          const index = chunkIndexRef.current;
          const now = Date.now();
          const record: ChunkRecord = {
            id: `${gravacaoId}-chunk-${index}`,
            gravacaoId,
            chunkIndex: index,
            data: blob,
            timestamp: now,
            status: "pending",
          };

          await db.put(INDEXEDDB.CHUNKS_STORE, record);

          // Update RecoveryRecord.lastChunkAt
          const recovery = await db.get(INDEXEDDB.RECOVERY_STORE, gravacaoId) as RecoveryRecord | undefined;
          if (recovery) {
            await db.put(INDEXEDDB.RECOVERY_STORE, { ...recovery, lastChunkAt: now });
          }

          chunkIndexRef.current++;

          setState((s) => ({
            chunkCount: s.chunkCount + 1,
            totalBytes: s.totalBytes + blob.size,
            lastSavedAt: now,
            error: null,
          }));

          return record;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));

          if (
            err instanceof DOMException &&
            err.name === "QuotaExceededError"
          ) {
            // No point retrying quota errors
            break;
          }

          if (attempt < MAX_RETRIES - 1) {
            await sleep(RETRY_DELAY_MS * (attempt + 1));
          }
        }
      }

      const message =
        lastError instanceof DOMException &&
        lastError.name === "QuotaExceededError"
          ? "Espaço em disco insuficiente."
          : "Falha ao salvar chunk — risco de perda de dados";
      setState((s) => ({ ...s, error: message }));
      throw new Error(message);
    },
    [gravacaoId, ensureDb]
  );

  const getAllChunks = useCallback(async (): Promise<ChunkRecord[]> => {
    const db = await ensureDb();
    const tx = db.transaction(INDEXEDDB.CHUNKS_STORE, "readonly");
    const idx = tx.store.index("by-gravacao");
    return idx.getAll(gravacaoId);
  }, [gravacaoId, ensureDb]);

  const consolidate = useCallback(async (): Promise<Blob> => {
    const chunks = await getAllChunks();
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    return new Blob(
      chunks.map((c) => c.data),
      { type: "video/webm" }
    );
  }, [getAllChunks]);

  const clearChunks = useCallback(async () => {
    const db = await ensureDb();
    const tx = db.transaction(INDEXEDDB.CHUNKS_STORE, "readwrite");
    const idx = tx.store.index("by-gravacao");
    let cursor = await idx.openCursor(gravacaoId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
    setState({ chunkCount: 0, totalBytes: 0, lastSavedAt: null, error: null });
  }, [gravacaoId, ensureDb]);

  const createRecoveryRecord = useCallback(
    async (metadata: ProcessMetadata, modo: ModoGravacao) => {
      const db = await ensureDb();
      const record: RecoveryRecord = {
        gravacaoId,
        metadata,
        modo,
        startedAt: Date.now(),
        lastChunkAt: Date.now(),
        status: "recording",
      };
      await db.put(INDEXEDDB.RECOVERY_STORE, record);
    },
    [gravacaoId, ensureDb]
  );

  const markRecoveryInterrupted = useCallback(async () => {
    const db = await ensureDb();
    const record = await db.get(INDEXEDDB.RECOVERY_STORE, gravacaoId) as RecoveryRecord | undefined;
    if (record) {
      await db.put(INDEXEDDB.RECOVERY_STORE, { ...record, status: "interrupted" });
    }
  }, [gravacaoId, ensureDb]);

  const clearRecoveryRecord = useCallback(async () => {
    const db = await ensureDb();
    await db.delete(INDEXEDDB.RECOVERY_STORE, gravacaoId);
  }, [gravacaoId, ensureDb]);

  const reset = useCallback(() => {
    chunkIndexRef.current = 0;
    setState({ chunkCount: 0, totalBytes: 0, lastSavedAt: null, error: null });
  }, []);

  return {
    ...state,
    saveChunk,
    getAllChunks,
    consolidate,
    clearChunks,
    createRecoveryRecord,
    markRecoveryInterrupted,
    clearRecoveryRecord,
    reset,
  };
};
