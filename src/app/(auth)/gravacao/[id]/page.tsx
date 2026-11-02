"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RecordingScreen } from "@/components/recording/RecordingScreen";
import { getDb } from "@/hooks/useChunkStorage";
import { INDEXEDDB } from "@/lib/constants";
import type { ProcessMetadata, RecoveryRecord, ModoGravacao } from "@/types/recording";

/**
 * Standalone recording page — used for recovery (retomar gravação).
 * The normal flow goes through the wizard at /gravacao/nova.
 * Loads metadata and modo from the RecoveryRecord in IndexedDB.
 */

const RECOVERY_PLACEHOLDER: ProcessMetadata = {
  numeroProcesso: "(Recuperando dados...)",
};

export default function GravacaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [metadata, setMetadata] = useState<ProcessMetadata>(RECOVERY_PLACEHOLDER);
  const [modo, setModo] = useState<ModoGravacao>("PRESENCIAL");

  useEffect(() => {
    const loadRecoveryData = async () => {
      try {
        const db = await getDb();
        const record = (await db.get(INDEXEDDB.RECOVERY_STORE, id)) as RecoveryRecord | undefined;
        if (record) {
          setMetadata(record.metadata);
          setModo(record.modo);
        }
      } catch {
        // Keep placeholder values
      }
    };
    loadRecoveryData();
  }, [id]);

  const handleComplete = useCallback(() => {
    router.push("/dashboard");
  }, [router]);

  return (
    <RecordingScreen
      gravacaoId={id}
      metadata={metadata}
      modo={modo}
      onComplete={handleComplete}
    />
  );
}
