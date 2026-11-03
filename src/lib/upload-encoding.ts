export const PJE_MAX_OUTPUT_SIZE_BYTES = 300 * 1024 * 1024;
export const PJE_TARGET_OUTPUT_SIZE_BYTES = Math.floor(PJE_MAX_OUTPUT_SIZE_BYTES * 0.97);

const NORMAL_MIN_VIDEO_KBPS = 500;
const NORMAL_AUDIO_KBPS = 96;
const NORMAL_RETRY_AUDIO_KBPS = 80;
const REDUCED_AUDIO_KBPS = 64;
const REDUCED_MIN_VIDEO_KBPS = 150;
const HEIGHT_480_MIN_VIDEO_KBPS = 250;

export interface EncodingPlan {
  videoKbps: number;
  audioKbps: number;
  preset: "faster" | "fast" | "medium";
  mode: "two-pass" | "single-pass";
  qualityReduced: boolean;
  maxHeight: number | null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function totalBudgetKbps(durationSeconds: number): number {
  return Math.floor((PJE_TARGET_OUTPUT_SIZE_BYTES * 8) / (durationSeconds * 1000));
}

export function estimateTargetVideoKbps(durationSeconds: number, audioKbps: number): number {
  return clamp(totalBudgetKbps(durationSeconds) - audioKbps, NORMAL_MIN_VIDEO_KBPS, 3500);
}

export function maxVideoKbpsByDuration(durationSeconds: number): number {
  if (durationSeconds <= 5 * 60) return 1400;
  if (durationSeconds <= 10 * 60) return 1800;
  if (durationSeconds <= 30 * 60) return 2200;
  return 2600;
}

export function computeVideoKbps(params: {
  durationSeconds: number;
  audioKbps: number;
  inputBitrateKbps: number | null;
}): number {
  const { durationSeconds, audioKbps, inputBitrateKbps } = params;
  const budgetVideoKbps = estimateTargetVideoKbps(durationSeconds, audioKbps);
  const durationCapKbps = maxVideoKbpsByDuration(durationSeconds);
  const noUpscaleKbps = inputBitrateKbps ? Math.floor(inputBitrateKbps * 0.95) : durationCapKbps;
  return clamp(
    Math.min(budgetVideoKbps, durationCapKbps, noUpscaleKbps),
    NORMAL_MIN_VIDEO_KBPS,
    durationCapKbps
  );
}

/**
 * Reduz a imagem só quando o vídeo ficaria abaixo de 500 kbps dentro do orçamento
 * de 300 MB. A faixa sai do orçamento, não da taxa da fonte.
 */
export function buildFirstEncodingAttempt(params: {
  durationSeconds: number;
  inputBitrateKbps: number | null;
}): EncodingPlan {
  const { durationSeconds, inputBitrateKbps } = params;
  const base = { preset: "faster", mode: "two-pass" } as const;
  const total = totalBudgetKbps(durationSeconds);

  if (total - NORMAL_AUDIO_KBPS >= NORMAL_MIN_VIDEO_KBPS) {
    return {
      ...base,
      videoKbps: computeVideoKbps({
        durationSeconds,
        audioKbps: NORMAL_AUDIO_KBPS,
        inputBitrateKbps,
      }),
      audioKbps: NORMAL_AUDIO_KBPS,
      qualityReduced: false,
      maxHeight: null,
    };
  }

  const budgetVideoKbps = total - REDUCED_AUDIO_KBPS;
  const sourceCapKbps = inputBitrateKbps ? Math.floor(inputBitrateKbps * 0.95) : budgetVideoKbps;
  return {
    ...base,
    // O piso vence o limite da fonte: uma fonte tão fraca provavelmente já cabe.
    videoKbps: Math.max(Math.min(budgetVideoKbps, sourceCapKbps), REDUCED_MIN_VIDEO_KBPS),
    audioKbps: REDUCED_AUDIO_KBPS,
    qualityReduced: true,
    maxHeight: budgetVideoKbps >= HEIGHT_480_MIN_VIDEO_KBPS ? 480 : 360,
  };
}

/**
 * Corrige a taxa pelo tamanho medido, sem reavaliar as faixas. Assim uma gravação de
 * 2 horas continua em 480p, e uma duração informada menor que a real também é compensada.
 * Retorna `null` no piso, onde não há o que reduzir.
 */
export function buildSecondEncodingAttempt(
  first: EncodingPlan,
  firstOutputBytes: number
): EncodingPlan | null {
  if (first.videoKbps <= REDUCED_MIN_VIDEO_KBPS) return null;

  const videoKbpsFor = (audioKbps: number) =>
    Math.max(
      Math.floor(
        ((first.videoKbps + first.audioKbps) * PJE_TARGET_OUTPUT_SIZE_BYTES) / firstOutputBytes
      ) - audioKbps,
      REDUCED_MIN_VIDEO_KBPS
    );
  const base = { preset: "fast", mode: "single-pass" } as const;

  if (!first.qualityReduced) {
    const videoKbps = videoKbpsFor(NORMAL_RETRY_AUDIO_KBPS);
    if (videoKbps >= NORMAL_MIN_VIDEO_KBPS) {
      return {
        ...base,
        videoKbps,
        audioKbps: NORMAL_RETRY_AUDIO_KBPS,
        qualityReduced: false,
        maxHeight: null,
      };
    }
  }

  return {
    ...base,
    videoKbps: videoKbpsFor(REDUCED_AUDIO_KBPS),
    audioKbps: REDUCED_AUDIO_KBPS,
    qualityReduced: true,
    maxHeight: first.maxHeight ?? 480,
  };
}

export function isMp4CodecCompatible(params: {
  videoCodec: string | null;
  audioCodec: string | null;
}): boolean {
  const video = (params.videoCodec ?? "").toLowerCase();
  const audio = (params.audioCodec ?? "").toLowerCase();
  const videoCompatible = ["h264", "avc1", "mpeg4", "hevc", "h265"].includes(video);
  const audioCompatible = audio.length === 0 || ["aac", "mp3", "ac3", "eac3"].includes(audio);
  return videoCompatible && audioCompatible;
}
