// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { Blob as NodeBlob } from "node:buffer";
import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChunkStorage, getDb } from "./useChunkStorage";
import { useRecovery } from "./useRecovery";
import { INDEXEDDB } from "@/lib/constants";
import type { ChunkRecord, ProcessMetadata, RecoveryRecord } from "@/types/recording";

globalThis.Blob = NodeBlob as unknown as typeof Blob;

const METADATA: ProcessMetadata = {
  numeroProcesso: "0001234-56.2026.4.01.3400",
  vara: "1a Vara",
};

const makeChunk = ({
  gravacaoId,
  chunkIndex,
  timestamp,
  segmentIndex = 0,
  content,
}: {
  gravacaoId: string;
  chunkIndex: number;
  timestamp: number;
  segmentIndex?: number;
  content: string;
}): ChunkRecord => ({
  id: `${gravacaoId}-chunk-${chunkIndex}`,
  gravacaoId,
  chunkIndex,
  segmentIndex,
  data: new NodeBlob([content], { type: "video/webm" }) as Blob,
  timestamp,
  status: "pending",
});

const makeRecovery = ({
  gravacaoId,
  status,
}: {
  gravacaoId: string;
  status: RecoveryRecord["status"];
}): RecoveryRecord => ({
  gravacaoId,
  metadata: METADATA,
  modo: "PRESENCIAL",
  startedAt: 1_710_000_000_000,
  lastChunkAt: 1_710_000_005_000,
  status,
});

const clearStores = async () => {
  const db = await getDb();
  await db.clear(INDEXEDDB.CHUNKS_STORE);
  await db.clear(INDEXEDDB.RECOVERY_STORE);
};

describe("recording recovery integration", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    await clearStores();
  });

  afterEach(async () => {
    await clearStores();
    vi.restoreAllMocks();
  });

  it("detecta gravação interrompida com chunks preservados e promove status recording para interrupted", async () => {
    const gravacaoId = "grav-recuperavel";
    const db = await getDb();

    await db.put(INDEXEDDB.RECOVERY_STORE, makeRecovery({ gravacaoId, status: "recording" }));
    await db.put(
      INDEXEDDB.CHUNKS_STORE,
      makeChunk({ gravacaoId, chunkIndex: 0, timestamp: 1_710_000_005_000, content: "chunk-a" })
    );
    await db.put(
      INDEXEDDB.CHUNKS_STORE,
      makeChunk({ gravacaoId, chunkIndex: 1, timestamp: 1_710_000_010_000, content: "chunk-b" })
    );

    const { result } = renderHook(() => useRecovery());

    await waitFor(() => expect(result.current.hasInterruptedRecording).toBe(true));

    expect(result.current.recoveryData).toMatchObject({
      gravacaoId,
      chunkCount: 2,
      totalBytes: expect.any(Number),
      metadata: METADATA,
    });
    expect(result.current.recoveryData?.totalBytes).toBeGreaterThan(0);

    const persisted = (await db.get(
      INDEXEDDB.RECOVERY_STORE,
      gravacaoId
    )) as RecoveryRecord | undefined;
    expect(persisted?.status).toBe("interrupted");
    expect(fetch).toHaveBeenCalledWith(`/api/gravacoes/${gravacaoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "INTERROMPIDA" }),
    });
  });

  it("remove recovery órfão quando não existem chunks para restaurar", async () => {
    const gravacaoId = "grav-sem-chunks";
    const db = await getDb();

    await db.put(INDEXEDDB.RECOVERY_STORE, makeRecovery({ gravacaoId, status: "interrupted" }));

    const { result } = renderHook(() => useRecovery());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasInterruptedRecording).toBe(false);
    expect(result.current.recoveryData).toBeNull();

    const persisted = await db.get(INDEXEDDB.RECOVERY_STORE, gravacaoId);
    expect(persisted).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("persiste chunks em ordem, atualiza recovery e consolida o conteúdo sem perda", async () => {
    const gravacaoId = "grav-chunk-storage";
    const { result } = renderHook(() => useChunkStorage(gravacaoId));

    await act(async () => {
      await result.current.createRecoveryRecord(METADATA, "PRESENCIAL");
    });

    await act(async () => {
      await result.current.saveChunk(new NodeBlob(["primeiro"], { type: "video/webm" }) as Blob);
      await result.current.saveChunk(new NodeBlob(["segundo"], { type: "video/webm" }) as Blob);
      result.current.beginNewSegment();
      await result.current.saveChunk(new NodeBlob(["terceiro"], { type: "video/webm" }) as Blob);
    });

    await waitFor(() => expect(result.current.chunkCount).toBe(3));

    const chunks = await result.current.getAllChunks();
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
    expect(chunks.map((chunk) => chunk.segmentIndex)).toEqual([0, 0, 1]);

    const consolidated = await result.current.consolidate();
    await expect(consolidated.text()).resolves.toBe("primeirosegundoterceiro");

    const recovery = (await getDb().then((db) =>
      db.get(INDEXEDDB.RECOVERY_STORE, gravacaoId)
    )) as RecoveryRecord | undefined;
    expect(recovery?.lastChunkAt).toBe(result.current.lastSavedAt);
  });
});
