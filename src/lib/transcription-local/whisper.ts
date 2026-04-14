import type { TranscriptSegment } from "@/lib/transcription-diarization";
import { LocalTranscriptionError } from "./errors";
import { execFileAsync } from "./exec";

interface WhisperConfig {
  whisperBin: string;
  whisperModelPath: string;
}

export function getWhisperConfig(): WhisperConfig {
  const whisperBin = process.env.WHISPER_CPP_BIN;
  const whisperModelPath = process.env.WHISPER_MODEL_PATH;

  if (!whisperBin || !whisperModelPath) {
    throw new LocalTranscriptionError(
      "CONFIG_MISSING",
      "Configuração ausente. Defina WHISPER_CPP_BIN e WHISPER_MODEL_PATH."
    );
  }

  return { whisperBin, whisperModelPath };
}

export async function runWhisperCpp(
  whisperBin: string,
  whisperModelPath: string,
  wavPath: string,
  outputBasePath: string,
  language: string
) {
  try {
    await execFileAsync(whisperBin, [
      "-m",
      whisperModelPath,
      "-f",
      wavPath,
      "-l",
      language,
      "-ovtt",
      "-otxt",
      "-of",
      outputBasePath,
    ]);
  } catch {
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Falha ao executar whisper.cpp para transcrição."
    );
  }
}

function vttTimestampToMs(ts: string): number {
  const parts = ts.split(":");
  if (parts.length === 3) {
    const [h, m, rest] = parts;
    const [s, ms] = rest.split(".");
    return (
      Number(h) * 3_600_000 +
      Number(m) * 60_000 +
      Number(s) * 1_000 +
      Number((ms ?? "0").padEnd(3, "0").slice(0, 3))
    );
  }
  const [m, rest] = parts;
  const [s, ms] = (rest ?? "0").split(".");
  return (
    Number(m ?? 0) * 60_000 +
    Number(s) * 1_000 +
    Number((ms ?? "0").padEnd(3, "0").slice(0, 3))
  );
}

const randomId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const VTT_CUE_RE = /^(\d[\d:.]+)\s*-->\s*(\d[\d:.]+)\s*$/;

export function parseVttToSegments(vttContent: string): TranscriptSegment[] {
  const lines = vttContent.split(/\r?\n/);
  const segments: TranscriptSegment[] = [];
  const createdAt = new Date().toISOString();

  let i = 0;
  while (i < lines.length) {
    const cueMatch = lines[i].match(VTT_CUE_RE);
    if (!cueMatch) {
      i += 1;
      continue;
    }

    const startMs = vttTimestampToMs(cueMatch[1]);
    const endMs = vttTimestampToMs(cueMatch[2]);
    i += 1;

    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i].trim());
      i += 1;
    }

    const text = textLines.join(" ").trim();
    if (text) {
      segments.push({
        id: randomId(),
        text,
        offsetMs: startMs,
        createdAt,
        startMs,
        endMs,
      });
    }
  }

  return segments;
}
