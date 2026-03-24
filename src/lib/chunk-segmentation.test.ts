import { describe, expect, it } from "vitest";
import { buildSegmentsFromChunks } from "./chunk-segmentation";

interface TestChunk {
  chunkIndex: number;
  timestamp: number;
  segmentIndex?: number;
  data: Blob;
}

const mkChunk = (
  chunkIndex: number,
  timestamp: number,
  segmentIndex?: number
): TestChunk => ({
  chunkIndex,
  timestamp,
  segmentIndex,
  data: new Blob([`chunk-${chunkIndex}`], { type: "video/webm" }),
});

describe("buildSegmentsFromChunks", () => {
  it("splits by explicit segmentIndex when available", () => {
    const chunks = [
      mkChunk(0, 1000, 0),
      mkChunk(1, 6000, 0),
      mkChunk(2, 9000, 1),
      mkChunk(3, 12000, 1),
    ];

    const segments = buildSegmentsFromChunks(chunks);
    expect(segments).toHaveLength(2);
    expect(segments[0].size).toBeGreaterThan(0);
    expect(segments[1].size).toBeGreaterThan(0);
  });

  it("falls back to timestamp gap splitting for legacy chunks", () => {
    const chunks = [
      mkChunk(0, 1000),
      mkChunk(1, 6000),
      // gap > 15000 (threshold), must start a new segment
      mkChunk(2, 30000),
      mkChunk(3, 35000),
    ];

    const segments = buildSegmentsFromChunks(chunks);
    expect(segments).toHaveLength(2);
  });
});
