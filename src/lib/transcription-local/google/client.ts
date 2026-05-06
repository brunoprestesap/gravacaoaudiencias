import { v2 } from "@google-cloud/speech";
import { Storage } from "@google-cloud/storage";

export type SpeechV2Client = v2.SpeechClient;
import { LocalTranscriptionError } from "../errors";
import {
  DEFAULT_GOOGLE_TRANSCRIPTION_LANGUAGE,
  DEFAULT_GOOGLE_TRANSCRIPTION_MODEL,
  DEFAULT_GOOGLE_TRANSCRIPTION_REGION,
  DEFAULT_GOOGLE_DIARIZATION_MAX_SPEAKERS,
  DEFAULT_GOOGLE_DIARIZATION_MIN_SPEAKERS,
} from "../constants";

export interface GoogleTranscriptionConfig {
  region: string;
  model: string;
  language: string;
  bucketName: string;
  diarizationEnabled: boolean;
  diarization: {
    minSpeakerCount: number;
    maxSpeakerCount: number;
  };
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getGoogleTranscriptionConfig(): GoogleTranscriptionConfig {
  const bucketName = process.env.GCS_TRANSCRIPTION_BUCKET?.trim();
  if (!bucketName) {
    throw new LocalTranscriptionError(
      "GCS_BUCKET_NOT_CONFIGURED",
      "GCS_TRANSCRIPTION_BUCKET não está configurado para o motor google."
    );
  }

  return {
    region: process.env.GOOGLE_TRANSCRIPTION_REGION?.trim() || DEFAULT_GOOGLE_TRANSCRIPTION_REGION,
    model: process.env.GOOGLE_TRANSCRIPTION_MODEL?.trim() || DEFAULT_GOOGLE_TRANSCRIPTION_MODEL,
    language:
      process.env.GOOGLE_TRANSCRIPTION_LANGUAGE?.trim() || DEFAULT_GOOGLE_TRANSCRIPTION_LANGUAGE,
    bucketName,
    // Default desligado: chirp_2 em batchRecognize não aceita diarizationConfig
    // e a Speech v2 devolve erro INVALID_ARGUMENT (que o gax às vezes mascara).
    // Quem usa um modelo compatível (ex.: long_v3) pode ligar pelo .env.
    diarizationEnabled: boolFromEnv("GOOGLE_TRANSCRIPTION_DIARIZATION_ENABLED", false),
    diarization: {
      minSpeakerCount: intFromEnv(
        "GOOGLE_TRANSCRIPTION_DIARIZATION_MIN_SPEAKERS",
        DEFAULT_GOOGLE_DIARIZATION_MIN_SPEAKERS
      ),
      maxSpeakerCount: intFromEnv(
        "GOOGLE_TRANSCRIPTION_DIARIZATION_MAX_SPEAKERS",
        DEFAULT_GOOGLE_DIARIZATION_MAX_SPEAKERS
      ),
    },
  };
}

function regionalEndpoint(region: string): string | undefined {
  if (!region || region === "global") return undefined;
  return `${region}-speech.googleapis.com`;
}

export function createSpeechClient(region: string): SpeechV2Client {
  const apiEndpoint = regionalEndpoint(region);
  // fallback: true força REST/JSON em vez de gRPC. gRPC pelo Next.js
  // (Turbopack/Webpack reempacota grpc-js) ocasionalmente devolve erro
  // com trailer vazio (`code/details: undefined`); em REST o erro vem
  // como HTTP normal com mensagem legível. A diferença de latência é
  // irrelevante para batchRecognize, que já é assíncrono via LRO.
  const useRest = boolFromEnv("GOOGLE_TRANSCRIPTION_USE_GRPC", false) === false;
  return new v2.SpeechClient({
    ...(apiEndpoint && { apiEndpoint }),
    ...(useRest && { fallback: true }),
  });
}

export function createStorageClient(): Storage {
  return new Storage();
}
