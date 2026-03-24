import { access } from "fs/promises";
import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { createBatchSegmentsFromText, type TranscriptSegment } from "@/lib/transcription-diarization";
import { extractGlobalVoiceFeatures, applyGlobalFeaturesToSegments } from "@/lib/voice-features";
import { execFileWithOutput } from "@/lib/upload-ffmpeg";

const WHISPER_MAX_BUFFER = 20 * 1024 * 1024;

export type LocalTranscriptionErrorCode =
  | "CONFIG_MISSING"
  | "INPUT_NOT_FOUND"
  | "FFMPEG_NOT_AVAILABLE"
  | "WHISPER_NOT_AVAILABLE"
  | "TRANSCRIPTION_FAILED"
  | "EMPTY_TRANSCRIPTION";

export class LocalTranscriptionError extends Error {
  code: LocalTranscriptionErrorCode;

  constructor(code: LocalTranscriptionErrorCode, message: string) {
    super(message);
    this.name = "LocalTranscriptionError";
    this.code = code;
  }
}

interface WhisperConfig {
  whisperBin: string;
  whisperModelPath: string;
}

interface TranscribeInput {
  inputVideoPath: string;
  language?: string;
}

interface TranscribeResult {
  text: string;
  segments: TranscriptSegment[];
}

function execFileAsync(command: string, args: string[]) {
  return execFileWithOutput(command, args, { maxBuffer: WHISPER_MAX_BUFFER });
}

function getWhisperConfig(): WhisperConfig {
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

export async function validateLocalTranscriptionRuntime() {
  const { whisperBin, whisperModelPath } = getWhisperConfig();
  try {
    await access(whisperModelPath);
  } catch {
    throw new LocalTranscriptionError(
      "CONFIG_MISSING",
      "Modelo Whisper não encontrado no caminho configurado."
    );
  }

  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    throw new LocalTranscriptionError(
      "FFMPEG_NOT_AVAILABLE",
      "FFmpeg não está disponível no servidor."
    );
  }

  try {
    await execFileAsync(whisperBin, ["--help"]);
  } catch {
    throw new LocalTranscriptionError(
      "WHISPER_NOT_AVAILABLE",
      "Binário do whisper.cpp não está disponível ou não é executável."
    );
  }
}

async function normalizeAudio(inputVideoPath: string, outputWavPath: string) {
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputVideoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      outputWavPath,
    ]);
  } catch {
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Falha ao normalizar áudio da gravação."
    );
  }
}

async function runWhisperCpp(
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

export async function transcribeLocalRecording({
  inputVideoPath,
  language = "pt",
}: TranscribeInput): Promise<TranscribeResult> {
  const { whisperBin, whisperModelPath } = getWhisperConfig();

  try {
    await access(inputVideoPath);
  } catch {
    throw new LocalTranscriptionError("INPUT_NOT_FOUND", "Arquivo da gravação não encontrado.");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audiencia-transcricao-"));
  const normalizedWavPath = path.join(tempDir, "audio.wav");
  const outputBasePath = path.join(tempDir, "transcricao");
  const outputTextPath = `${outputBasePath}.txt`;

  try {
    await normalizeAudio(inputVideoPath, normalizedWavPath);
    await runWhisperCpp(whisperBin, whisperModelPath, normalizedWavPath, outputBasePath, language);

    const text = (await readFile(outputTextPath, "utf-8")).trim();
    if (!text) {
      throw new LocalTranscriptionError(
        "EMPTY_TRANSCRIPTION",
        "A transcrição foi concluída, mas o texto retornou vazio."
      );
    }

    const globalVoiceFeatures = await extractGlobalVoiceFeatures(normalizedWavPath);
    const baseSegments = createBatchSegmentsFromText(text);
    const segmentsWithVoice = applyGlobalFeaturesToSegments(baseSegments, globalVoiceFeatures);

    return {
      text,
      segments: segmentsWithVoice,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
