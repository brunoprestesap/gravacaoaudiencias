import type { google } from "@google-cloud/speech/build/protos/protos";
import type { TranscriptSegment } from "@/lib/transcription-diarization";

type IBatchRecognizeFileResult = google.cloud.speech.v2.IBatchRecognizeFileResult;
type ISpeechRecognitionResult = google.cloud.speech.v2.ISpeechRecognitionResult;
type IWordInfo = google.cloud.speech.v2.IWordInfo;
type IDuration = google.protobuf.IDuration;

const MAX_SEGMENT_DURATION_MS = 15_000;

function durationToMs(duration: IDuration | null | undefined): number | undefined {
  if (!duration) return undefined;
  const rawSeconds = duration.seconds;
  const seconds =
    typeof rawSeconds === "string"
      ? Number(rawSeconds)
      : typeof rawSeconds === "number"
        ? rawSeconds
        : rawSeconds && typeof rawSeconds === "object" && typeof (rawSeconds as { toNumber?: () => number }).toNumber === "function"
          ? (rawSeconds as { toNumber: () => number }).toNumber()
          : 0;
  const nanos = typeof duration.nanos === "number" ? duration.nanos : 0;
  if (!Number.isFinite(seconds)) return undefined;
  return Math.round(seconds * 1000 + nanos / 1_000_000);
}

function joinWords(words: IWordInfo[]): string {
  let out = "";
  for (const word of words) {
    const value = (word.word ?? "").trim();
    if (!value) continue;
    if (out.length === 0) {
      out = value;
      continue;
    }
    if (/^[.,!?;:…)]/.test(value)) {
      out += value;
    } else {
      out += ` ${value}`;
    }
  }
  return out;
}

function avgConfidence(words: IWordInfo[]): number | undefined {
  const values = words
    .map((word) => word.confidence)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fileResultsFromResponse(
  fileResult: IBatchRecognizeFileResult
): ISpeechRecognitionResult[] {
  const inline = fileResult.inlineResult?.transcript?.results;
  if (Array.isArray(inline) && inline.length > 0) {
    return inline;
  }
  const direct = fileResult.transcript?.results;
  if (Array.isArray(direct) && direct.length > 0) {
    return direct;
  }
  return [];
}

interface SegmentBuilder {
  words: IWordInfo[];
  speakerLabel: string | null;
  startMs: number | undefined;
  alternativeConfidence: number | undefined;
}

function emit(builder: SegmentBuilder, createdAt: string): TranscriptSegment {
  const text = joinWords(builder.words).trim();
  const lastWord = builder.words[builder.words.length - 1];
  const endMs = durationToMs(lastWord?.endOffset) ?? builder.startMs;
  const wordConfidence = avgConfidence(builder.words);
  const confidence = wordConfidence ?? builder.alternativeConfidence;
  const startMs = builder.startMs ?? 0;
  return {
    id: `${createdAt}-${startMs}`,
    text,
    offsetMs: startMs,
    createdAt,
    startMs,
    endMs,
    speakerId: builder.speakerLabel ?? undefined,
    confidence,
  };
}

export function parseChirpResponse(
  fileResult: IBatchRecognizeFileResult,
  createdAt: string = new Date().toISOString()
): { text: string; segments: TranscriptSegment[] } {
  const results = fileResultsFromResponse(fileResult);

  const segments: TranscriptSegment[] = [];
  let active: SegmentBuilder | null = null;

  const flush = () => {
    if (!active || active.words.length === 0) return;
    const segment = emit(active, createdAt);
    if (segment.text.length > 0) {
      segments.push(segment);
    }
    active = null;
  };

  for (const result of results) {
    const alternative = result.alternatives?.[0];
    if (!alternative) continue;

    const altConfidence =
      typeof alternative.confidence === "number" ? alternative.confidence : undefined;
    const words = Array.isArray(alternative.words) ? alternative.words : [];

    if (words.length === 0) {
      const transcript = (alternative.transcript ?? "").trim();
      if (!transcript) continue;
      flush();
      const endMs = durationToMs(result.resultEndOffset);
      segments.push({
        id: `${createdAt}-${segments.length}`,
        text: transcript,
        offsetMs: 0,
        createdAt,
        startMs: 0,
        endMs,
        confidence: altConfidence,
      });
      continue;
    }

    for (const word of words) {
      const startMs = durationToMs(word.startOffset);
      const speakerLabel = word.speakerLabel ?? null;

      if (!active) {
        active = {
          words: [word],
          speakerLabel,
          startMs,
          alternativeConfidence: altConfidence,
        };
        continue;
      }

      const speakerChanged = active.speakerLabel !== speakerLabel;
      const tooLong =
        typeof active.startMs === "number" &&
        typeof startMs === "number" &&
        startMs - active.startMs >= MAX_SEGMENT_DURATION_MS;

      if (speakerChanged || tooLong) {
        flush();
        active = {
          words: [word],
          speakerLabel,
          startMs,
          alternativeConfidence: altConfidence,
        };
        continue;
      }

      active.words.push(word);
    }
  }

  flush();

  const text = segments.map((segment) => segment.text).join(" ").trim();
  return { text, segments };
}
