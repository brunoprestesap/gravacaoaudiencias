import type { TranscriptSegment } from "@/lib/transcription-diarization";

const FIXED_SEGMENTS: Array<{ text: string; offsetMs: number; speakerId: string }> = [
  { text: "Está aberta a audiência.", offsetMs: 0, speakerId: "S1" },
  { text: "Boa tarde, excelência.", offsetMs: 2000, speakerId: "S2" },
  { text: "Vamos prosseguir com a oitiva.", offsetMs: 4000, speakerId: "S1" },
];

export async function transcribeWithMock(): Promise<{
  text: string;
  baseSegments: TranscriptSegment[];
}> {
  const baseSegments: TranscriptSegment[] = FIXED_SEGMENTS.map((seg, idx) => ({
    id: `mock-${idx}`,
    text: seg.text,
    offsetMs: seg.offsetMs,
    createdAt: new Date(0).toISOString(),
    speakerId: seg.speakerId,
    startMs: seg.offsetMs,
    endMs: seg.offsetMs + 1500,
    confidence: 0.99,
  }));
  const text = baseSegments.map((s) => s.text).join(" ");
  return { text, baseSegments };
}
