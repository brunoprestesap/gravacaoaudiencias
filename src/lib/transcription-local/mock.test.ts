import { describe, expect, it } from "vitest";
import { transcribeWithMock } from "./mock";

describe("transcribeWithMock", () => {
  it("retorna texto e segmentos fixos sem depender de IO real", async () => {
    const result = await transcribeWithMock();
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.baseSegments.length).toBeGreaterThanOrEqual(3);
    expect(result.baseSegments[0]).toMatchObject({
      text: expect.any(String),
      offsetMs: expect.any(Number),
    });
  });

  it("produz segmentos com offsets monotonicamente crescentes", async () => {
    const { baseSegments } = await transcribeWithMock();
    for (let i = 1; i < baseSegments.length; i += 1) {
      expect(baseSegments[i].offsetMs).toBeGreaterThan(baseSegments[i - 1].offsetMs);
    }
  });
});
