import { describe, expect, it } from "vitest";
import { buildEncodingPlan, computeVideoKbps, isMp4CodecCompatible } from "./upload-encoding";

describe("upload encoding strategy", () => {
  it("builds reduced encoding plan with 2 attempts", () => {
    const plan = buildEncodingPlan({
      durationSeconds: 30 * 60,
      inputBitrateKbps: 1800,
    });
    expect(plan).toHaveLength(2);
    expect(plan[0].mode).toBe("two-pass");
    expect(plan[1].mode).toBe("single-pass");
  });

  it("never upscales above source bitrate budget", () => {
    const videoKbps = computeVideoKbps({
      durationSeconds: 10 * 60,
      audioKbps: 96,
      multiplier: 1,
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
