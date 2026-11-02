import { describe, expect, it } from "vitest";
import {
  parseWhisperMlxOutput,
  segmentsFromWhisperMlxPayload,
} from "./whisper-mlx";

describe("parseWhisperMlxOutput", () => {
  it("parseia JSON válido com text e segments", () => {
    const raw = JSON.stringify({
      text: "Boa tarde Excelência.",
      segments: [{ text: "Boa tarde Excelência.", start: 0.0, end: 3.5 }],
    });
    const result = parseWhisperMlxOutput(raw);
    expect(result.text).toBe("Boa tarde Excelência.");
    expect(result.segments).toHaveLength(1);
  });

  it("parseia JSON sem segments (campo ausente)", () => {
    const raw = JSON.stringify({ text: "Texto simples." });
    const result = parseWhisperMlxOutput(raw);
    expect(result.text).toBe("Texto simples.");
    expect(result.segments).toBeUndefined();
  });

  it("lança TRANSCRIPTION_FAILED em JSON inválido", () => {
    expect(() => parseWhisperMlxOutput("não é json")).toThrow();
  });
});

describe("segmentsFromWhisperMlxPayload", () => {
  it("converte start/end de segundos para ms", () => {
    const payload = {
      text: "Olá mundo.",
      segments: [
        { text: "Olá", start: 0.0, end: 1.5 },
        { text: "mundo.", start: 1.5, end: 3.2 },
      ],
    };
    const segments = segmentsFromWhisperMlxPayload(payload);
    expect(segments).not.toBeNull();
    expect(segments![0].startMs).toBe(0);
    expect(segments![0].endMs).toBe(1500);
    expect(segments![1].startMs).toBe(1500);
    expect(segments![1].endMs).toBe(3200);
  });

  it("retorna null quando segments está ausente", () => {
    const result = segmentsFromWhisperMlxPayload({ text: "algo" });
    expect(result).toBeNull();
  });

  it("retorna null quando segments é array vazio", () => {
    const result = segmentsFromWhisperMlxPayload({ text: "algo", segments: [] });
    expect(result).toBeNull();
  });

  it("pula segmentos com texto vazio", () => {
    const payload = {
      text: "válido",
      segments: [
        { text: "", start: 0, end: 1 },
        { text: "válido", start: 1, end: 2 },
      ],
    };
    const segments = segmentsFromWhisperMlxPayload(payload);
    expect(segments).toHaveLength(1);
    expect(segments![0].text).toBe("válido");
  });

  it("seta offsetMs igual a startMs", () => {
    const payload = {
      text: "teste",
      segments: [{ text: "teste", start: 2.0, end: 4.0 }],
    };
    const segments = segmentsFromWhisperMlxPayload(payload);
    expect(segments![0].offsetMs).toBe(2000);
    expect(segments![0].startMs).toBe(2000);
  });
});
