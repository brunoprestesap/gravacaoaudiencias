import path from "path";
import type { TranscriptSegment } from "@/lib/transcription-diarization";
import { DEFAULT_HF_MODEL_ID, WHISPER_MAX_BUFFER } from "./constants";
import { LocalTranscriptionError } from "./errors";
import { execFileAsyncWithEnv, logSubprocessFailure } from "./exec";

export interface Wav2VecJsonSegment {
  text?: string;
  startMs?: number;
  endMs?: number;
  offsetMs?: number;
}

export interface Wav2VecJsonPayload {
  text?: string;
  segments?: Wav2VecJsonSegment[];
}

export function getTranscriptionPython(): string {
  return (process.env.TRANSCRIPTION_PYTHON ?? "python3").trim() || "python3";
}

export function getWav2VecScriptPath(): string {
  const fromEnv = process.env.TRANSCRIPTION_WAV2VEC_SCRIPT?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "scripts", "transcribe_wav2vec2.py");
}

function randomSegmentId(index: number) {
  return `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 10)}`;
}

export function segmentsFromWav2VecPayload(payload: Wav2VecJsonPayload): TranscriptSegment[] | null {
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
          : i * 5000;
    const endMs = typeof item.endMs === "number" ? item.endMs : startMs + 4500;
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

export function parseWav2VecTranscriptionOutput(raw: string): Wav2VecJsonPayload {
  try {
    return JSON.parse(raw) as Wav2VecJsonPayload;
  } catch {
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Saída inválida do motor Wav2Vec2 (JSON)."
    );
  }
}

export async function runWav2VecPython(wavPath: string, jsonOutPath: string) {
  const pythonBin = getTranscriptionPython();
  const scriptPath = getWav2VecScriptPath();

  const env = { ...process.env };
  if (!env.HF_MODEL_ID?.trim()) {
    env.HF_MODEL_ID = DEFAULT_HF_MODEL_ID;
  }

  try {
    await execFileAsyncWithEnv(pythonBin, [scriptPath, wavPath, jsonOutPath], {
      maxBuffer: WHISPER_MAX_BUFFER,
      env,
    });
  } catch (err) {
    logSubprocessFailure("wav2vec2", err);
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Falha ao executar a transcrição Wav2Vec2 (Python)."
    );
  }
}
