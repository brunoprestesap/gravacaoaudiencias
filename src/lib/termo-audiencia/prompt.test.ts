import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import type { TranscriptSegment } from "@/lib/transcription-diarization";

describe("buildSystemPrompt", () => {
  it("contém regras de classificação da sentença", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("extincao_sem_merito");
    expect(prompt).toContain("procedencia");
    expect(prompt).toContain("improcedencia");
    expect(prompt).toContain("acordo");
  });

  it("orienta fidelidade à transcrição", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toContain("fiel");
    expect(prompt.toLowerCase()).toContain("nunca invente");
  });

  it("descreve o formato Markdown esperado", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("# TERMO DE AUDIÊNCIA");
    expect(prompt).toContain("DISPOSITIVO");
  });
});

describe("buildUserPrompt", () => {
  const metadata = {
    numeroProcesso: "1004354-87.2026.4.01.3100",
    classeProcessual: "Procedimento Comum",
    partes: "Maria vs INSS",
    vara: "JEF Itinerante",
    nomeJuiz: "JUCÉLIO FLEURY NETO",
    tipoAudiencia: "Conciliação, Instrução e Julgamento",
    dataAudiencia: "2026-05-05",
  };

  const segmentos: TranscriptSegment[] = [
    {
      id: "1",
      text: "Está aberta a audiência.",
      offsetMs: 0,
      createdAt: "2026-05-05T12:00:00Z",
      role: "JUIZ",
    },
    {
      id: "2",
      text: "Boa tarde, excelência.",
      offsetMs: 2000,
      createdAt: "2026-05-05T12:00:02Z",
      role: "PARTE",
    },
    {
      id: "3",
      text: "Manifesto pelo INSS.",
      offsetMs: 5000,
      createdAt: "2026-05-05T12:00:05Z",
      role: "PROCURADOR",
    },
  ];

  it("inclui todos os metadados do processo", () => {
    const prompt = buildUserPrompt({ metadata, segmentos });
    expect(prompt).toContain("1004354-87.2026.4.01.3100");
    expect(prompt).toContain("Procedimento Comum");
    expect(prompt).toContain("Maria vs INSS");
    expect(prompt).toContain("JEF Itinerante");
    expect(prompt).toContain("JUCÉLIO FLEURY NETO");
    expect(prompt).toContain("Conciliação, Instrução e Julgamento");
    expect(prompt).toContain("2026-05-05");
  });

  it("formata os segmentos com prefixos de papel", () => {
    const prompt = buildUserPrompt({ metadata, segmentos });
    expect(prompt).toContain("[JUIZ] Está aberta a audiência.");
    expect(prompt).toContain("[PARTE] Boa tarde, excelência.");
    expect(prompt).toContain("[PROCURADOR] Manifesto pelo INSS.");
  });

  it("usa fallback texto se segmentos vazios", () => {
    const prompt = buildUserPrompt({
      metadata,
      segmentos: [],
      fallbackTexto: "Texto bruto da transcrição.",
    });
    expect(prompt).toContain("TRANSCRIÇÃO (sem diarização):");
    expect(prompt).toContain("Texto bruto da transcrição.");
  });

  it("trata role ausente como DESCONHECIDO", () => {
    const semRole: TranscriptSegment[] = [
      {
        id: "x",
        text: "Algo dito sem identificação.",
        offsetMs: 0,
        createdAt: "2026-05-05T12:00:00Z",
      },
    ];
    const prompt = buildUserPrompt({ metadata, segmentos: semRole });
    expect(prompt).toContain("[DESCONHECIDO] Algo dito sem identificação.");
  });
});
