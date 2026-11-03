import { describe, expect, it } from "vitest";
import {
  buildFirstEncodingAttempt,
  buildSecondEncodingAttempt,
  computeVideoKbps,
  type EncodingPlan,
  isMp4CodecCompatible,
  PJE_MAX_OUTPUT_SIZE_BYTES,
  PJE_TARGET_OUTPUT_SIZE_BYTES,
} from "./upload-encoding";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const SOURCE_KBPS = 2100;

const first = (durationSeconds: number, inputBitrateKbps: number | null = SOURCE_KBPS) =>
  buildFirstEncodingAttempt({ durationSeconds, inputBitrateKbps });

describe("upload encoding strategy", () => {
  it("never upscales above source bitrate budget", () => {
    const videoKbps = computeVideoKbps({
      durationSeconds: 10 * 60,
      audioKbps: 96,
      inputBitrateKbps: 1000,
    });
    expect(videoKbps).toBeLessThanOrEqual(950);
  });

  it("accepts only mp4 compatible codec pairs", () => {
    expect(
      isMp4CodecCompatible({
        videoCodec: "h264",
        audioCodec: "aac",
      })
    ).toBe(true);
    expect(
      isMp4CodecCompatible({
        videoCodec: "vp9",
        audioCodec: "opus",
      })
    ).toBe(false);
  });
});

describe("primeira tentativa", () => {
  it("mantém o plano de hoje em gravações curtas", () => {
    expect(first(30 * MINUTE)).toEqual({
      videoKbps: 1260,
      audioKbps: 96,
      preset: "faster",
      mode: "two-pass",
      qualityReduced: false,
      maxHeight: null,
    });
    expect(first(60 * MINUTE)).toMatchObject({
      videoKbps: 582,
      audioKbps: 96,
      qualityReduced: false,
      maxHeight: null,
    });
  });

  it("reduz só quando o vídeo ficaria abaixo de 500 kbps", () => {
    expect(first(4095)).toMatchObject({ videoKbps: 500, audioKbps: 96, qualityReduced: false });
    expect(first(4110)).toMatchObject({ audioKbps: 64, qualityReduced: true, maxHeight: 480 });
  });

  it("uma gravação de 2 horas sai em 480p, com cerca de 275 kbps e áudio de 64 kbps", () => {
    expect(first(2 * HOUR)).toEqual({
      videoKbps: 275,
      audioKbps: 64,
      preset: "faster",
      mode: "two-pass",
      qualityReduced: true,
      maxHeight: 480,
    });
  });

  it("passa a 360p em cerca de 2h10", () => {
    expect(first(7770)).toMatchObject({ videoKbps: 250, maxHeight: 480 });
    expect(first(7780)).toMatchObject({ videoKbps: 249, maxHeight: 360 });
    expect(first(2.5 * HOUR)).toMatchObject({ videoKbps: 207, audioKbps: 64, maxHeight: 360 });
  });

  it("para no piso de 150 kbps acima de cerca de 3h10", () => {
    expect(first(11400)).toMatchObject({ videoKbps: 150, maxHeight: 360 });
    expect(first(4 * HOUR)).toMatchObject({ videoKbps: 150, audioKbps: 64, maxHeight: 360 });
  });

  it("nas faixas reduzidas respeita a taxa da fonte, mas não fica abaixo do piso", () => {
    expect(first(2 * HOUR, 200)).toMatchObject({ videoKbps: 190, maxHeight: 480 });
    expect(first(2 * HOUR, 100)).toMatchObject({ videoKbps: 150, maxHeight: 480 });
  });

  it("sem taxa da fonte, usa só o orçamento", () => {
    expect(first(2 * HOUR, null)).toMatchObject({ videoKbps: 275, maxHeight: 480 });
  });
});

describe("segunda tentativa", () => {
  const measured = (factor: number) => Math.round(PJE_MAX_OUTPUT_SIZE_BYTES * factor);

  it("mantém 480p em 2 horas e tira a taxa do tamanho medido", () => {
    const second = buildSecondEncodingAttempt(first(2 * HOUR), PJE_TARGET_OUTPUT_SIZE_BYTES * 1.1);
    expect(second).toEqual({
      videoKbps: Math.floor((275 + 64) / 1.1) - 64,
      audioKbps: 64,
      preset: "fast",
      mode: "single-pass",
      qualityReduced: true,
      maxHeight: 480,
    });
  });

  it("mantém 360p quando a primeira já estava em 360p", () => {
    expect(buildSecondEncodingAttempt(first(2.5 * HOUR), measured(1.05))?.maxHeight).toBe(360);
  });

  it("não roda quando a primeira já estava no piso", () => {
    expect(buildSecondEncodingAttempt(first(4 * HOUR), measured(1.5))).toBeNull();
  });

  it("nunca desce abaixo do piso", () => {
    expect(buildSecondEncodingAttempt(first(2 * HOUR), measured(5))?.videoKbps).toBe(150);
  });

  it("na faixa normal continua normal enquanto o recálculo der 500 kbps ou mais", () => {
    expect(buildSecondEncodingAttempt(first(30 * MINUTE), measured(1.1))).toMatchObject({
      audioKbps: 80,
      qualityReduced: false,
      maxHeight: null,
    });
  });

  it("na faixa normal cai para 480p quando o recálculo dá menos de 500 kbps", () => {
    const start: EncodingPlan = first(60 * MINUTE);
    const bytes = PJE_TARGET_OUTPUT_SIZE_BYTES * 1.5;
    expect(buildSecondEncodingAttempt(start, bytes)).toEqual({
      videoKbps: Math.floor((582 + 96) / 1.5) - 64,
      audioKbps: 64,
      preset: "fast",
      mode: "single-pass",
      qualityReduced: true,
      maxHeight: 480,
    });
  });
});
