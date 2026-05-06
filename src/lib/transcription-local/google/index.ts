import type { TranscriptSegment } from "@/lib/transcription-diarization";
import type { ProcessMetadata } from "@/types/recording";
import { createSpeechClient, createStorageClient, getGoogleTranscriptionConfig } from "./client";
import { uploadWavToGcs } from "./gcs-upload";
import { resolveProjectId, runBatchRecognize } from "./recognize";
import { parseChirpResponse } from "./parse-response";

export interface GoogleTranscribeResult {
  text: string;
  baseSegments: TranscriptSegment[];
}

export async function transcribeNormalizedWavWithGoogle(
  normalizedWavPath: string,
  metadata?: ProcessMetadata
): Promise<GoogleTranscribeResult> {
  const config = getGoogleTranscriptionConfig();
  const speechClient = createSpeechClient(config.region);
  const storage = createStorageClient();

  const projectId = await resolveProjectId(speechClient);
  const upload = await uploadWavToGcs(storage, config.bucketName, normalizedWavPath);

  try {
    const fileResult = await runBatchRecognize({
      client: speechClient,
      config,
      projectId,
      audioGcsUri: upload.gcsUri,
      metadata,
    });
    const { text, segments } = parseChirpResponse(fileResult);
    return { text, baseSegments: segments };
  } finally {
    await upload.cleanup();
  }
}

export { getGoogleTranscriptionConfig } from "./client";
