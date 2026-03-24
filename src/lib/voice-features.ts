import type { TranscriptSegment, VoiceFeatures } from "@/lib/transcription-diarization";
import { execFileWithOutput } from "@/lib/upload-ffmpeg";

const AUDIO_MAX_BUFFER = 20 * 1024 * 1024;

function execFileAsync(command: string, args: string[]) {
  return execFileWithOutput(command, args, { maxBuffer: AUDIO_MAX_BUFFER });
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

/**
 * Extrai features de voz globais (pitch, energia, taxa de pausa) de um arquivo WAV
 * usando ffmpeg astats e silencedetect.
 */
export async function extractGlobalVoiceFeatures(wavPath: string): Promise<VoiceFeatures> {
  let astatsStderr = "";
  try {
    const astatsResult = await execFileAsync("ffmpeg", [
      "-i",
      wavPath,
      "-af",
      "astats=metadata=1:reset=1",
      "-f",
      "null",
      "-",
    ]);
    astatsStderr = astatsResult.stderr;
  } catch {
    return {};
  }

  const rmsLevels = [...astatsStderr.matchAll(/RMS level dB:\s*(-?\d+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  const zeroCrossRates = [...astatsStderr.matchAll(/Zero crossings rate:\s*(\d+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));

  let silenceStderr = "";
  try {
    const silenceResult = await execFileAsync("ffmpeg", [
      "-i",
      wavPath,
      "-af",
      "silencedetect=noise=-34dB:d=0.25",
      "-f",
      "null",
      "-",
    ]);
    silenceStderr = silenceResult.stderr;
  } catch {
    silenceStderr = "";
  }

  const silenceDurations = [...silenceStderr.matchAll(/silence_duration:\s*(\d+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  const totalSilenceSec = silenceDurations.reduce((acc, value) => acc + value, 0);

  const durationMatch = astatsStderr.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  let totalDurationSec = 0;
  if (durationMatch) {
    totalDurationSec = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  }

  const avgRmsDb = average(rmsLevels);
  const avgZeroCrossRate = average(zeroCrossRates);
  const approxPitch = typeof avgZeroCrossRate === "number"
    ? Math.max(50, Math.min(420, avgZeroCrossRate * 800))
    : undefined;
  const pauseRatio = totalDurationSec > 0 ? Math.min(1, totalSilenceSec / totalDurationSec) : undefined;

  return {
    pitchMeanHz: approxPitch,
    pitchStdHz: typeof approxPitch === "number" ? approxPitch * 0.15 : undefined,
    energyMeanDb: avgRmsDb,
    pauseRatio,
    speechRateApprox: undefined,
  };
}

/**
 * Aplica features globais de voz a cada segmento com pequena perturbação por índice,
 * simulando variação entre locutores.
 */
export function applyGlobalFeaturesToSegments(
  segments: TranscriptSegment[],
  globalFeatures: VoiceFeatures
): TranscriptSegment[] {
  return segments.map((segment, index) => {
    const perturbation = ((index % 3) - 1) * 0.04;
    const pitchBase = globalFeatures.pitchMeanHz;
    const pauseBase = globalFeatures.pauseRatio;
    return {
      ...segment,
      voiceFeatures: {
        ...globalFeatures,
        pitchMeanHz: typeof pitchBase === "number"
          ? Math.max(50, pitchBase * (1 + perturbation))
          : undefined,
        pauseRatio: typeof pauseBase === "number"
          ? Math.min(1, Math.max(0, pauseBase + perturbation * 0.5))
          : undefined,
      },
    };
  });
}
