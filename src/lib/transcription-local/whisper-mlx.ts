import path from "path";
import type { TranscriptSegment } from "@/lib/transcription-diarization";
import { DEFAULT_WHISPER_MLX_MODEL_ID, WHISPER_MAX_BUFFER } from "./constants";
import { LocalTranscriptionError } from "./errors";
import { execFileAsyncWithEnv, logSubprocessFailure } from "./exec";
import { getTranscriptionPython } from "./wav2vec";

export interface WhisperMlxJsonSegment {
  text?: string;
  start?: number;
  end?: number;
}

export interface WhisperMlxJsonPayload {
  text?: string;
  segments?: WhisperMlxJsonSegment[];
}

export function getWhisperMlxScriptPath(): string {
  const fromEnv = process.env.TRANSCRIPTION_WHISPER_MLX_SCRIPT?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "scripts", "transcribe_whisper_mlx.py");
}

export function getWhisperMlxModelId(): string {
  return (
    process.env.WHISPER_MLX_MODEL_ID?.trim() || DEFAULT_WHISPER_MLX_MODEL_ID
  );
}

function randomSegmentId(index: number) {
  return `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 10)}`;
}

export function segmentsFromWhisperMlxPayload(
  payload: WhisperMlxJsonPayload
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
      typeof item.start === "number" ? Math.round(item.start * 1000) : i * 5000;
    const endMs =
      typeof item.end === "number" ? Math.round(item.end * 1000) : startMs + 4500;

    out.push({
      id: randomSegmentId(i),
      text,
      offsetMs: startMs,
      createdAt,
      startMs,
      endMs,
    });
  }

  return out.length > 0 ? out : null;
}

export function parseWhisperMlxOutput(raw: string): WhisperMlxJsonPayload {
  try {
    return JSON.parse(raw) as WhisperMlxJsonPayload;
  } catch {
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Saída inválida do motor whisper-mlx (JSON)."
    );
  }
}

export async function runWhisperMlxPython(wavPath: string, jsonOutPath: string) {
  const pythonBin = getTranscriptionPython();
  const scriptPath = getWhisperMlxScriptPath();

  const env = { ...process.env };
  if (!env.WHISPER_MLX_MODEL_ID?.trim()) {
    env.WHISPER_MLX_MODEL_ID = DEFAULT_WHISPER_MLX_MODEL_ID;
  }

  try {
    await execFileAsyncWithEnv(pythonBin, [scriptPath, wavPath, jsonOutPath], {
      maxBuffer: WHISPER_MAX_BUFFER,
      env,
    });
  } catch (err) {
    logSubprocessFailure("whisper-mlx", err);
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Falha ao executar a transcrição whisper-mlx (Python)."
    );
  }
}
