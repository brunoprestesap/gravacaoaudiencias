import { describe, expect, it } from "vitest";
import { buildPhraseHints } from "./phrase-set";

describe("buildPhraseHints", () => {
  it("retorna apenas vocabulário base quando metadata é vazio", () => {
    const hints = buildPhraseHints();
    expect(hints.length).toBeGreaterThan(0);
    // Sem metadata: só vocabulário (boost 10) e vocabulário técnico (boost 12).
    expect(hints.every((hint) => hint.boost === 10 || hint.boost === 12)).toBe(true);
    expect(hints.some((hint) => hint.value === "Excelência" && hint.boost === 10)).toBe(true);
    expect(hints.some((hint) => hint.value === "BPC" && hint.boost === 12)).toBe(true);
    expect(hints.some((hint) => hint.value === "Pregabalina" && hint.boost === 12)).toBe(true);
  });

  it("inclui termos do processo com boost maior antes do vocabulário", () => {
    const hints = buildPhraseHints({
      numeroProcesso: "1234567-89.2025.4.01.3800",
      vara: "1ª Vara Federal de Brasília",
      nomeJuiz: "Maria Silva",
      partes: "Empresa X, Pessoa Y",
      classeProcessual: "Procedimento Comum",
      tipoAudiencia: "Instrução",
    });

    const processo = hints.find((h) => h.value === "1234567-89.2025.4.01.3800");
    expect(processo?.boost).toBe(15);
    const juiz = hints.find((h) => h.value === "Maria Silva");
    expect(juiz?.boost).toBe(15);
    const parteX = hints.find((h) => h.value === "Empresa X");
    expect(parteX?.boost).toBe(15);
    const parteY = hints.find((h) => h.value === "Pessoa Y");
    expect(parteY?.boost).toBe(15);

    const idxJuiz = hints.findIndex((h) => h.value === "Maria Silva");
    const idxVocab = hints.findIndex((h) => h.boost === 10);
    expect(idxJuiz).toBeLessThan(idxVocab);
  });

  it("gera variações de contexto para juiz e partes (aumenta casamento)", () => {
    const hints = buildPhraseHints({
      numeroProcesso: "1",
      nomeJuiz: "Maria Silva",
      partes: "João da Silva, Maria Souza",
    });

    expect(hints.some((h) => h.value === "Excelentíssimo Maria Silva")).toBe(true);
    expect(hints.some((h) => h.value === "Senhor João da Silva")).toBe(true);
    expect(hints.some((h) => h.value === "depoimento de Maria Souza")).toBe(true);
    expect(hints.some((h) => h.value === "advogado da parte João da Silva")).toBe(true);
  });

  it("deduplica entradas case-insensitive", () => {
    const hints = buildPhraseHints({
      numeroProcesso: "ABC",
      vara: "abc",
      partes: "ABC",
    });
    const matches = hints.filter((h) => h.value.toLowerCase() === "abc");
    expect(matches).toHaveLength(1);
  });

  it("ignora partes muito curtas (< 3 chars)", () => {
    const hints = buildPhraseHints({
      numeroProcesso: "1234567",
      partes: "AB, Empresa Longa",
    });
    expect(hints.some((h) => h.value === "AB")).toBe(false);
    expect(hints.some((h) => h.value === "Empresa Longa")).toBe(true);
  });

  it("limita a 200 phrases no total", () => {
    const partesLonga = Array.from({ length: 500 }, (_, i) => `Parte ${i + 1}`).join(", ");
    const hints = buildPhraseHints({ numeroProcesso: "1", partes: partesLonga });
    expect(hints.length).toBeLessThanOrEqual(200);
  });

  it("intercala vocabulário técnico e jurídico em audiência típica (até ~10 partes)", () => {
    // Cenário realista: ~10 partes nomeadas. A interleave garante que tanto
    // pharma quanto vocab jurídico/médico aparecem nos hints — antes da
    // mudança a ordem fixa [processo → técnico → vocabulário] cortava o
    // vocab quando processo+técnico saturavam o budget.
    const partesLonga = Array.from({ length: 10 }, (_, i) => `Parte Numero ${i + 1}`).join(", ");
    const hints = buildPhraseHints({
      numeroProcesso: "1234567-89.2025.4.01.3800",
      partes: partesLonga,
    });
    expect(hints.length).toBeLessThanOrEqual(200);
    expect(hints.some((h) => h.value === "Pregabalina")).toBe(true);
    expect(hints.some((h) => h.value === "lombalgia")).toBe(true);
    expect(hints.some((h) => h.value === "Excelência")).toBe(true);
  });
});
