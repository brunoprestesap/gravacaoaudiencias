export const PJE_MAX_OUTPUT_SIZE_BYTES = 300 * 1024 * 1024;
export const PJE_TARGET_OUTPUT_SIZE_BYTES = Math.floor(PJE_MAX_OUTPUT_SIZE_BYTES * 0.97);

export interface EncodingAttempt {
  multiplier: number;
  audioKbps: number;
  preset: "faster" | "fast" | "medium";
}

export interface EncodingPlan {
  videoKbps: number;
  audioKbps: number;
  preset: "faster" | "fast" | "medium";
  mode: "two-pass" | "single-pass";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function estimateTargetVideoKbps(
  durationSeconds: number,
  audioKbps: number,
  multiplier: number
): number {
  const totalKbps = Math.floor((PJE_TARGET_OUTPUT_SIZE_BYTES * 8) / (durationSeconds * 1000));
  const adjustedKbps = Math.floor(totalKbps * multiplier) - audioKbps;
  return clamp(adjustedKbps, 500, 3500);
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
  multiplier: number;
  inputBitrateKbps: number | null;
}): number {
  const { durationSeconds, audioKbps, multiplier, inputBitrateKbps } = params;
  const budgetVideoKbps = estimateTargetVideoKbps(durationSeconds, audioKbps, multiplier);
  const durationCapKbps = maxVideoKbpsByDuration(durationSeconds);
  const noUpscaleKbps = inputBitrateKbps ? Math.floor(inputBitrateKbps * 0.95) : durationCapKbps;
  return clamp(Math.min(budgetVideoKbps, durationCapKbps, noUpscaleKbps), 500, durationCapKbps);
}

export function buildEncodingPlan(params: {
  durationSeconds: number;
  inputBitrateKbps: number | null;
}): EncodingPlan[] {
  const { durationSeconds, inputBitrateKbps } = params;
  const attempts: [EncodingAttempt & { mode: "two-pass" | "single-pass" }, ...Array<EncodingAttempt & { mode: "two-pass" | "single-pass" }>] = [
    { multiplier: 1, audioKbps: 96, preset: "faster", mode: "two-pass" },
    { multiplier: 0.82, audioKbps: 80, preset: "fast", mode: "single-pass" },
  ];
  return attempts.map((attempt) => ({
    videoKbps: computeVideoKbps({
      durationSeconds,
      audioKbps: attempt.audioKbps,
      multiplier: attempt.multiplier,
      inputBitrateKbps,
    }),
    audioKbps: attempt.audioKbps,
    preset: attempt.preset,
    mode: attempt.mode,
  }));
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
