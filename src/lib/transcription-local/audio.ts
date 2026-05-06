import { execFile } from "child_process";
import { access } from "fs/promises";
import path from "path";
import { LocalTranscriptionError } from "./errors";
import { execFileAsync } from "./exec";

export type AudioPreprocessMode = "basic" | "loudness" | "full";

/**
 * Caminho do WAV pré-extraído (mono 16kHz PCM) que o pipeline de upload escreve
 * direto do WebM original (Opus → PCM, uma só decode lossy). Quando presente,
 * a transcrição usa este arquivo em vez do MP4 — evita a 2ª compressão lossy
 * (AAC do MP4) que degrada a qualidade espectral entregue ao Chirp 2.
 */
export function transcriptionAudioPathFor(videoPath: string): string {
  const dir = path.dirname(videoPath);
  const ext = path.extname(videoPath);
  const base = path.basename(videoPath, ext);
  return path.join(dir, `${base}.transcricao.wav`);
}

export async function findTranscriptionAudioSibling(
  videoPath: string
): Promise<string | null> {
  const candidate = transcriptionAudioPathFor(videoPath);
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

const HIGHPASS_HZ = 80;
const LOWPASS_HZ = 7800;
const LOUDNORM_TARGET = "I=-16:TP=-1.5:LRA=11";

// Default `basic` (sem filtros) bate com a recomendação da OpenAI Cookbook:
// Whisper foi treinado em áudio bruto/ruidoso; pré-processamento agressivo
// (highpass/lowpass/denoise) modifica a representação espectral e tende a
// PIORAR o WER. Use `loudness` apenas se houver volumes muito desiguais
// (ex.: juiz longe do mic vs. parte no mic).
function getPreprocessMode(): AudioPreprocessMode {
  const raw = process.env.TRANSCRIPTION_AUDIO_PREPROCESS?.trim().toLowerCase();
  if (raw === "full") return "full";
  if (raw === "loudness" || raw === "mild") return "loudness";
  return "basic";
}

const LOUDNORM_KEYS: Array<keyof LoudnormMeasurement> = [
  "input_i",
  "input_tp",
  "input_lra",
  "input_thresh",
  "target_offset",
];

function parseLoudnormJson(stderr: string): LoudnormMeasurement | null {
  // FFmpeg emite o bloco JSON ao final do stderr. Procuramos a última
  // chave de abertura para evitar capturar logs intermediários.
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(stderr.slice(start, end + 1)) as Record<string, unknown>;
    const out = {} as LoudnormMeasurement;
    for (const key of LOUDNORM_KEYS) {
      const v = parsed[key];
      if (typeof v !== "string" && typeof v !== "number") return null;
      out[key] = String(v);
    }
    return out;
  } catch {
    return null;
  }
}

function execFileCaptureStderr(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stderr ?? "");
    });
  });
}

async function measureLoudness(inputVideoPath: string): Promise<LoudnormMeasurement | null> {
  try {
    const stderr = await execFileCaptureStderr("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-i",
      inputVideoPath,
      "-vn",
      "-af",
      `loudnorm=${LOUDNORM_TARGET}:print_format=json`,
      "-f",
      "null",
      "-",
    ]);
    return parseLoudnormJson(stderr);
  } catch {
    return null;
  }
}

async function runFfmpegBasic(inputVideoPath: string, outputWavPath: string) {
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
}

function buildLoudnormFilter(measured: LoudnormMeasurement | null): string | null {
  if (measured) {
    return (
      `loudnorm=${LOUDNORM_TARGET}:linear=true` +
      `:measured_I=${measured.input_i}` +
      `:measured_TP=${measured.input_tp}` +
      `:measured_LRA=${measured.input_lra}` +
      `:measured_thresh=${measured.input_thresh}` +
      `:offset=${measured.target_offset}`
    );
  }
  // Sem medições do pass-1: NÃO aplica loudnorm dinâmico (single-pass), que
  // distorce dinâmica de fala e pode piorar o WER. Volta ao modo básico.
  return null;
}

async function runFfmpegWithFilters(
  inputVideoPath: string,
  outputWavPath: string,
  filters: string[]
) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    inputVideoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-af",
    filters.join(","),
    "-c:a",
    "pcm_s16le",
    outputWavPath,
  ]);
}

export async function normalizeAudio(
  inputVideoPath: string,
  outputWavPath: string,
  options?: { mode?: AudioPreprocessMode }
) {
  const mode = options?.mode ?? getPreprocessMode();

  try {
    if (mode === "basic") {
      await runFfmpegBasic(inputVideoPath, outputWavPath);
      return;
    }

    const measured = await measureLoudness(inputVideoPath);
    const loudnorm = buildLoudnormFilter(measured);

    if (!loudnorm) {
      // Pass-1 não retornou medições parseáveis — caímos para basic em vez de
      // aplicar single-pass dinâmico, que costuma reduzir a precisão.
      await runFfmpegBasic(inputVideoPath, outputWavPath);
      return;
    }

    if (mode === "loudness") {
      await runFfmpegWithFilters(inputVideoPath, outputWavPath, [loudnorm]);
      return;
    }

    // mode === "full": loudness + highpass + lowpass.
    // Atenção: filtros espectrais podem PIORAR o WER (Whisper foi treinado em
    // áudio bruto). Use só se você validou empiricamente o ganho.
    await runFfmpegWithFilters(inputVideoPath, outputWavPath, [
      `highpass=f=${HIGHPASS_HZ}`,
      `lowpass=f=${LOWPASS_HZ}`,
      loudnorm,
    ]);
  } catch {
    throw new LocalTranscriptionError(
      "TRANSCRIPTION_FAILED",
      "Falha ao normalizar áudio da gravação."
    );
  }
}
