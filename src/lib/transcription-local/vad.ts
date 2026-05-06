import path from "path";
import { readFile } from "fs/promises";
import type { TranscriptSegment } from "@/lib/transcription-diarization";
import { WHISPER_MAX_BUFFER } from "./constants";
import { LocalTranscriptionError } from "./errors";
import { execFileAsyncWithEnv, logSubprocessFailure } from "./exec";
import { getTranscriptionPython } from "./wav2vec";

export interface VadSegmentMapping {
  speech_start_ms: number;
  speech_end_ms: number;
  orig_start_ms: number;
  orig_end_ms: number;
}

export interface VadPayload {
  segments: VadSegmentMapping[];
  original_duration_ms?: number;
}

export function isVadEnabled(): boolean {
  const raw = process.env.TRANSCRIPTION_USE_VAD?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function getVadScriptPath(): string {
  const fromEnv = process.env.TRANSCRIPTION_VAD_SCRIPT?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "scripts", "preprocess_vad.py");
}

export async function runVadPreprocess(
  inputWavPath: string,
  outputWavPath: string,
  jsonOutPath: string
): Promise<VadPayload | null> {
  const pythonBin = getTranscriptionPython();
  const scriptPath = getVadScriptPath();

  try {
    await execFileAsyncWithEnv(
      pythonBin,
      [scriptPath, inputWavPath, outputWavPath, jsonOutPath],
      { maxBuffer: WHISPER_MAX_BUFFER }
    );
  } catch (err) {
    logSubprocessFailure("silero-vad", err);
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Falha ao executar pré-segmentação VAD (Silero)."
    );
  }

  try {
    const raw = await readFile(jsonOutPath, "utf-8");
    const parsed = JSON.parse(raw) as VadPayload;
    if (!Array.isArray(parsed.segments)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Mapeia timestamps do espaço "speech" (áudio concatenado pelo VAD) de volta
// para o tempo original. Cada segmento Whisper tem startMs/endMs no eixo do
// áudio comprimido; precisamos achar o trecho VAD correspondente e somar o
// offset original.
export function mapSegmentsToOriginalTimeline(
  segments: TranscriptSegment[],
  mapping: VadSegmentMapping[]
): TranscriptSegment[] {
  if (mapping.length === 0) return segments;

  return segments.map((seg) => {
    const remappedStart = locateOriginalMs(seg.startMs ?? 0, mapping);
    const remappedEnd = locateOriginalMs(
      seg.endMs ?? seg.startMs ?? 0,
      mapping,
      true
    );
    return {
      ...seg,
      startMs: remappedStart,
      endMs: Math.max(remappedStart, remappedEnd),
      offsetMs: remappedStart,
    };
  });
}

function locateOriginalMs(
  speechMs: number,
  mapping: VadSegmentMapping[],
  preferEnd = false
): number {
  for (const m of mapping) {
    if (speechMs <= m.speech_end_ms) {
      const into = Math.max(0, speechMs - m.speech_start_ms);
      const candidate = m.orig_start_ms + into;
      return Math.min(candidate, m.orig_end_ms);
    }
  }
  // Estourou o final do mapping: ancora no fim do último segmento.
  const last = mapping[mapping.length - 1];
  return preferEnd ? last.orig_end_ms : last.orig_start_ms;
}
