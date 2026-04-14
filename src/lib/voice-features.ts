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

function stdev(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Converte palavras do texto + duração em escala compatível com `speechRateApprox`
 * (mesma ordem de grandeza usada nas heurísticas de prosódia).
 */
function estimateSpeechRateFromText(text: string, durationSec: number): number | undefined {
  if (durationSec < 0.22) return undefined;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 2) return undefined;
  const wpm = (words / durationSec) * 60;
  return Math.min(210, Math.max(72, wpm * 0.62));
}

function parseAstatsSilence(astatsStderr: string, silenceStderr: string): VoiceFeatures {
  const overallMatch = astatsStderr.match(/\]\s*Overall\r?\n/);
  const preOverall = overallMatch?.index != null
    ? astatsStderr.slice(0, overallMatch.index)
    : astatsStderr;

  const rmsLevels = [...preOverall.matchAll(/RMS level dB:\s*(-?\d+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));

  const zeroCrossRates = [...preOverall.matchAll(/Zero crossings rate:\s*(\d+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));

  const crestFactors = [...preOverall.matchAll(/Crest factor:\s*([\d.]+)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));

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
  const crestFactorMean = average(crestFactors);

  const pitchPerWindow = zeroCrossRates.map((z) => Math.max(50, Math.min(420, z * 800)));
  const pitchMeanHz = median(pitchPerWindow)
    ?? (typeof avgZeroCrossRate === "number"
      ? Math.max(50, Math.min(420, avgZeroCrossRate * 800))
      : undefined);
  const pitchStdFromWindows = stdev(pitchPerWindow);
  const pitchStdHz = typeof pitchStdFromWindows === "number" && pitchStdFromWindows > 0.01
    ? pitchStdFromWindows
    : typeof pitchMeanHz === "number"
      ? pitchMeanHz * 0.14
      : undefined;

  const energyStdDb = stdev(rmsLevels);

  let spectralFluxApprox: number | undefined;
  if (rmsLevels.length >= 2) {
    let flux = 0;
    for (let i = 1; i < rmsLevels.length; i += 1) {
      flux += Math.abs(rmsLevels[i]! - rmsLevels[i - 1]!);
    }
    spectralFluxApprox = flux / (rmsLevels.length - 1);
  }

  const entropyVals = [...astatsStderr.matchAll(/Entropy:\s*([\d.]+)/g)]
    .map((m) => Number(m[1]))
    .filter((v) => Number.isFinite(v));
  const dynVals = [...astatsStderr.matchAll(/Dynamic range:\s*([\d.]+)/g)]
    .map((m) => Number(m[1]))
    .filter((v) => Number.isFinite(v));
  const entropyMean = entropyVals.length > 0 ? entropyVals[entropyVals.length - 1] : undefined;
  const dynamicRangeDb = dynVals.length > 0 ? dynVals[dynVals.length - 1] : undefined;

  const pauseRatio = totalDurationSec > 0 ? Math.min(1, totalSilenceSec / totalDurationSec) : undefined;

  return {
    pitchMeanHz,
    pitchStdHz,
    energyMeanDb: avgRmsDb,
    pauseRatio,
    speechRateApprox: undefined,
    zeroCrossingRateMean: avgZeroCrossRate,
    crestFactorMean,
    entropyMean: Number.isFinite(entropyMean) ? entropyMean : undefined,
    dynamicRangeDb: Number.isFinite(dynamicRangeDb) ? dynamicRangeDb : undefined,
    energyStdDb,
    spectralFluxApprox,
  };
}

async function runAstats(wavPath: string, extraInputArgs: string[] = []): Promise<string> {
  try {
    const result = await execFileAsync("ffmpeg", [
      ...extraInputArgs,
      "-i", wavPath,
      "-af", "astats=metadata=1:reset=1",
      "-f", "null", "-",
    ]);
    return result.stderr;
  } catch {
    return "";
  }
}

async function runSilenceDetect(wavPath: string, extraInputArgs: string[] = []): Promise<string> {
  try {
    const result = await execFileAsync("ffmpeg", [
      ...extraInputArgs,
      "-i", wavPath,
      "-af", "silencedetect=noise=-34dB:d=0.25",
      "-f", "null", "-",
    ]);
    return result.stderr;
  } catch {
    return "";
  }
}

/**
 * Extrai features de voz globais (pitch, energia, timbre, pausas) de um arquivo WAV
 * usando ffmpeg astats e silencedetect.
 */
export async function extractGlobalVoiceFeatures(wavPath: string): Promise<VoiceFeatures> {
  const astatsStderr = await runAstats(wavPath);
  if (!astatsStderr) return {};
  const silenceStderr = await runSilenceDetect(wavPath);
  return parseAstatsSilence(astatsStderr, silenceStderr);
}

async function extractSliceVoiceFeaturesOnce(
  wavPath: string,
  startSec: number,
  durationSec: number,
  includeSilence: boolean
): Promise<VoiceFeatures> {
  const seekArgs = ["-ss", startSec.toFixed(3), "-t", durationSec.toFixed(3)];
  const astatsStderr = await runAstats(wavPath, seekArgs);
  if (!astatsStderr) return {};
  const silenceStderr = includeSilence ? await runSilenceDetect(wavPath, seekArgs) : "";
  return parseAstatsSilence(astatsStderr, silenceStderr);
}

/** Pitch médio no fim vs no início (proxy de entonação ascendente em "né?", etc.). */
async function mergePitchEndLift(
  wavPath: string,
  startSec: number,
  durationSec: number,
  base: VoiceFeatures
): Promise<VoiceFeatures> {
  if (durationSec < 0.48) return base;
  const firstLen = Math.min(0.36, Math.max(0.14, durationSec * 0.32));
  const lastLen = Math.min(0.34, Math.max(0.14, durationSec * 0.28));
  const first = await extractSliceVoiceFeaturesOnce(wavPath, startSec, firstLen, false);
  const lastStart = startSec + Math.max(0, durationSec - lastLen);
  const last = await extractSliceVoiceFeaturesOnce(wavPath, lastStart, lastLen, false);
  if (typeof first.pitchMeanHz === "number" && typeof last.pitchMeanHz === "number") {
    return { ...base, pitchEndLiftHz: last.pitchMeanHz - first.pitchMeanHz };
  }
  return base;
}

/**
 * Extrai features de voz para um trecho específico do WAV usando seek/duration.
 * Trechos longos usam sub-janelas para medir variabilidade de energia e tom (prosódia).
 */
async function extractSliceVoiceFeatures(
  wavPath: string,
  startSec: number,
  durationSec: number
): Promise<VoiceFeatures> {
  const base = await extractSliceVoiceFeaturesOnce(wavPath, startSec, durationSec, true);

  if (durationSec < 1.0) {
    return mergePitchEndLift(wavPath, startSec, durationSec, base);
  }

  const n = Math.min(5, Math.max(3, Math.round(durationSec / 0.42)));
  const w = durationSec / n;
  const subEnergies: number[] = [];
  const subPitches: number[] = [];

  for (let i = 0; i < n; i += 1) {
    const ss = startSec + i * w;
    const tt = Math.max(0.3, w - 0.02);
    const sub = await extractSliceVoiceFeaturesOnce(wavPath, ss, tt, false);
    if (typeof sub.energyMeanDb === "number") {
      subEnergies.push(sub.energyMeanDb);
    }
    if (typeof sub.pitchMeanHz === "number") {
      subPitches.push(sub.pitchMeanHz);
    }
  }

  const crossEnergyStd = stdev(subEnergies);
  const crossPitchStd = stdev(subPitches);

  if (typeof crossEnergyStd === "number" && crossEnergyStd > 0) {
    base.energyStdDb = typeof base.energyStdDb === "number"
      ? Math.max(base.energyStdDb, crossEnergyStd)
      : crossEnergyStd;
  }

  if (typeof crossPitchStd === "number" && crossPitchStd > 0) {
    base.pitchStdHz = typeof base.pitchStdHz === "number"
      ? Math.max(base.pitchStdHz, crossPitchStd)
      : crossPitchStd;
  }

  return mergePitchEndLift(wavPath, startSec, durationSec, base);
}

/**
 * Extrai features de voz reais para cada segmento que possui timestamps (startMs/endMs).
 * Segmentos sem timestamps recebem as features globais como fallback.
 */
export async function extractSegmentVoiceFeatures(
  segments: TranscriptSegment[],
  wavPath: string
): Promise<TranscriptSegment[]> {
  const globalFeatures = await extractGlobalVoiceFeatures(wavPath);

  const results = await Promise.all(
    segments.map(async (segment) => {
      if (
        typeof segment.startMs === "number"
        && typeof segment.endMs === "number"
        && segment.endMs > segment.startMs
      ) {
        const startSec = segment.startMs / 1000;
        const durationSec = (segment.endMs - segment.startMs) / 1000;
        if (durationSec >= 0.3) {
          let features = await extractSliceVoiceFeatures(wavPath, startSec, durationSec);
          const fromText = estimateSpeechRateFromText(segment.text, durationSec);
          if (fromText !== undefined) {
            features = {
              ...features,
              speechRateApprox: typeof features.speechRateApprox === "number"
                ? features.speechRateApprox * 0.58 + fromText * 0.42
                : fromText,
            };
          }
          if (features.pitchMeanHz !== undefined || features.energyMeanDb !== undefined) {
            return { ...segment, voiceFeatures: features };
          }
        }
      }
      return { ...segment, voiceFeatures: globalFeatures };
    })
  );

  return results;
}
