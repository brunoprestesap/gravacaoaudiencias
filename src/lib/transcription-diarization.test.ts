import { describe, expect, it } from "vitest";
import {
  diarizeSegmentsByRole,
  inferSpeakerRoleFromText,
  type TranscriptSegment,
} from "./transcription-diarization";

describe("transcription-diarization", () => {
  it("reconhece juiz por padrão de condução da audiência", () => {
    const result = inferSpeakerRoleFromText("Excelência, declaro aberta a audiência.");
    expect(result.role).toBe("JUIZ");
  });

  it("reduz DESCONHECIDO com fallback de continuidade por voz", () => {
    const segments: TranscriptSegment[] = [
      {
        id: "1",
        text: "Doutor, pode falar.",
        offsetMs: 1000,
        createdAt: new Date().toISOString(),
        voiceFeatures: { pitchMeanHz: 140, energyMeanDb: -18, pauseRatio: 0.42, speechRateApprox: 88 },
      },
      {
        id: "2",
        text: "Perfeito.",
        offsetMs: 5000,
        createdAt: new Date().toISOString(),
        voiceFeatures: { pitchMeanHz: 144, energyMeanDb: -19, pauseRatio: 0.40, speechRateApprox: 90 },
      },
    ];

    const diarized = diarizeSegmentsByRole(segments);
    expect(diarized[0].role).toBe("JUIZ");
    expect(diarized[1].role).toBe("JUIZ");
    expect(diarized[1].confidence).toBeGreaterThan(0.5);
  });
});
