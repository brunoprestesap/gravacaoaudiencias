import { describe, expect, it } from "vitest";
import type { google } from "@google-cloud/speech/build/protos/protos";
import { parseChirpResponse } from "./parse-response";

type FileResult = google.cloud.speech.v2.IBatchRecognizeFileResult;
type WordInfo = google.cloud.speech.v2.IWordInfo;

const word = (
  text: string,
  startSec: number,
  endSec: number,
  speakerLabel?: string,
  confidence?: number
): WordInfo => ({
  word: text,
  startOffset: { seconds: Math.floor(startSec), nanos: Math.round((startSec % 1) * 1e9) },
  endOffset: { seconds: Math.floor(endSec), nanos: Math.round((endSec % 1) * 1e9) },
  speakerLabel,
  confidence,
});

const fileResultFrom = (
  results: google.cloud.speech.v2.ISpeechRecognitionResult[]
): FileResult => ({
  inlineResult: { transcript: { results } },
});

describe("parseChirpResponse", () => {
  const createdAt = "2026-05-04T12:00:00.000Z";

  it("agrupa palavras consecutivas do mesmo speaker em um segmento", () => {
    const fileResult = fileResultFrom([
      {
        alternatives: [
          {
            transcript: "Boa tarde Excelência",
            confidence: 0.95,
            words: [
              word("Boa", 0, 0.4, "1"),
              word("tarde", 0.4, 0.8, "1"),
              word("Excelência", 0.8, 1.5, "1"),
            ],
          },
        ],
      },
    ]);

    const { text, segments } = parseChirpResponse(fileResult, createdAt);
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("Boa tarde Excelência");
    expect(segments[0].speakerId).toBe("1");
    expect(segments[0].startMs).toBe(0);
    expect(segments[0].endMs).toBe(1500);
    expect(text).toBe("Boa tarde Excelência");
  });

  it("quebra segmento quando o speaker muda", () => {
    const fileResult = fileResultFrom([
      {
        alternatives: [
          {
            words: [
              word("Está", 0, 0.5, "1"),
              word("aberta", 0.5, 1.0, "1"),
              word("Sim", 2.0, 2.5, "2"),
              word("Excelência", 2.5, 3.5, "2"),
            ],
          },
        ],
      },
    ]);

    const { segments } = parseChirpResponse(fileResult, createdAt);
    expect(segments).toHaveLength(2);
    expect(segments[0].speakerId).toBe("1");
    expect(segments[0].text).toBe("Está aberta");
    expect(segments[1].speakerId).toBe("2");
    expect(segments[1].text).toBe("Sim Excelência");
  });

  it("quebra segmento muito longo (>15s) mesmo com speaker constante", () => {
    const fileResult = fileResultFrom([
      {
        alternatives: [
          {
            words: [
              word("alpha", 0, 1, "1"),
              word("beta", 1, 2, "1"),
              word("gamma", 16, 17, "1"),
            ],
          },
        ],
      },
    ]);

    const { segments } = parseChirpResponse(fileResult, createdAt);
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe("alpha beta");
    expect(segments[1].text).toBe("gamma");
  });

  it("anexa pontuação adjacente sem espaço extra", () => {
    const fileResult = fileResultFrom([
      {
        alternatives: [
          {
            words: [
              word("Sim", 0, 0.5, "1"),
              word(",", 0.5, 0.6, "1"),
              word("Excelência", 0.6, 1.2, "1"),
              word(".", 1.2, 1.3, "1"),
            ],
          },
        ],
      },
    ]);

    const { segments } = parseChirpResponse(fileResult, createdAt);
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("Sim, Excelência.");
  });

  it("usa transcript inteiro quando words[] vem vazio", () => {
    const fileResult = fileResultFrom([
      {
        alternatives: [
          {
            transcript: "fragmento solto",
            confidence: 0.7,
            words: [],
          },
        ],
        resultEndOffset: { seconds: 4, nanos: 0 },
      },
    ]);

    const { text, segments } = parseChirpResponse(fileResult, createdAt);
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("fragmento solto");
    expect(segments[0].confidence).toBeCloseTo(0.7);
    expect(segments[0].endMs).toBe(4000);
    expect(text).toBe("fragmento solto");
  });

  it("retorna vazio quando não há resultados", () => {
    const { text, segments } = parseChirpResponse({}, createdAt);
    expect(segments).toHaveLength(0);
    expect(text).toBe("");
  });

  it("calcula confidence média a partir das palavras", () => {
    const fileResult = fileResultFrom([
      {
        alternatives: [
          {
            confidence: 0.5,
            words: [
              word("um", 0, 0.5, "1", 0.8),
              word("dois", 0.5, 1, "1", 1.0),
            ],
          },
        ],
      },
    ]);

    const { segments } = parseChirpResponse(fileResult, createdAt);
    expect(segments[0].confidence).toBeCloseTo(0.9);
  });
});
