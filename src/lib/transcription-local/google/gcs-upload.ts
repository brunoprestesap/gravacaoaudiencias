import path from "path";
import { randomUUID } from "crypto";
import type { Storage } from "@google-cloud/storage";
import { LocalTranscriptionError } from "../errors";

export interface UploadedAudio {
  /** URI no formato gs://bucket/object aceito pela API Speech-to-Text v2. */
  gcsUri: string;
  /** Limpa o blob no GCS. Idempotente — pode ser chamado em finally sem checagem. */
  cleanup: () => Promise<void>;
}

const PREFIX = "transcricoes";

export async function uploadWavToGcs(
  storage: Storage,
  bucketName: string,
  localWavPath: string
): Promise<UploadedAudio> {
  const objectName = `${PREFIX}/${randomUUID()}${path.extname(localWavPath) || ".wav"}`;
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectName);

  try {
    await bucket.upload(localWavPath, {
      destination: objectName,
      resumable: false,
      metadata: {
        contentType: "audio/wav",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha desconhecida no upload para GCS.";
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      `Falha ao enviar áudio para GCS: ${message}`
    );
  }

  return {
    gcsUri: `gs://${bucketName}/${objectName}`,
    cleanup: async () => {
      try {
        await file.delete({ ignoreNotFound: true });
      } catch (err) {
        console.warn(
          `[transcricao] falha ao remover blob ${objectName} do bucket ${bucketName}:`,
          err
        );
      }
    },
  };
}
