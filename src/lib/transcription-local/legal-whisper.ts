import path from "path";
import type { TranscriptSegment } from "@/lib/transcription-diarization";
import {
  DEFAULT_LEGAL_WHISPER_BASE_MODEL_ID,
  DEFAULT_LEGAL_WHISPER_MODEL_ID,
  WHISPER_MAX_BUFFER,
} from "./constants";
import { LocalTranscriptionError } from "./errors";
import { execFileAsyncWithEnv, logSubprocessFailure } from "./exec";
import { getTranscriptionPython } from "./wav2vec";

export interface LegalWhisperJsonSegment {
  text?: string;
  startMs?: number;
  endMs?: number;
  offsetMs?: number;
}

export interface LegalWhisperJsonPayload {
  text?: string;
  segments?: LegalWhisperJsonSegment[];
}

export function getLegalWhisperScriptPath(): string {
  const fromEnv = process.env.TRANSCRIPTION_LEGAL_WHISPER_SCRIPT?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "scripts", "transcribe_legal_whisper.py");
}

function randomSegmentId(index: number) {
  return `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 10)}`;
}

export function segmentsFromLegalWhisperPayload(
  payload: LegalWhisperJsonPayload
): TranscriptSegment[] | null {
  const list = payload.segments;
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }

  const createdAt = new Date().toISOString();
  const out: TranscriptSegment[] = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) continue;

    const startMs =
      typeof item.startMs === "number"
        ? item.startMs
        : typeof item.offsetMs === "number"
          ? item.offsetMs
          : i * 30000;
    const endMs = typeof item.endMs === "number" ? item.endMs : startMs + 29500;
    const offsetMs = typeof item.offsetMs === "number" ? item.offsetMs : startMs;

    out.push({
      id: randomSegmentId(i),
      text,
      offsetMs,
      createdAt,
      startMs,
      endMs,
    });
  }

  return out.length > 0 ? out : null;
}

export function parseLegalWhisperTranscriptionOutput(raw: string): LegalWhisperJsonPayload {
  try {
    return JSON.parse(raw) as LegalWhisperJsonPayload;
  } catch {
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Saída inválida do motor Whisper PEFT (JSON)."
    );
  }
}

export async function runLegalWhisperPython(wavPath: string, jsonOutPath: string) {
  const pythonBin = getTranscriptionPython();
  const scriptPath = getLegalWhisperScriptPath();

  const env = { ...process.env };
  if (!env.LEGAL_WHISPER_MODEL_ID?.trim()) {
    env.LEGAL_WHISPER_MODEL_ID = DEFAULT_LEGAL_WHISPER_MODEL_ID;
  }
  if (!env.LEGAL_WHISPER_BASE_MODEL_ID?.trim()) {
    env.LEGAL_WHISPER_BASE_MODEL_ID = DEFAULT_LEGAL_WHISPER_BASE_MODEL_ID;
  }

  try {
    await execFileAsyncWithEnv(pythonBin, [scriptPath, wavPath, jsonOutPath], {
      maxBuffer: WHISPER_MAX_BUFFER,
      env,
    });
  } catch (err) {
    logSubprocessFailure("legal-whisper", err);
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Falha ao executar a transcrição Whisper PEFT (Python)."
    );
  }
}
