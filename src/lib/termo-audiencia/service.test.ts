import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptSegment } from "@/lib/transcription-diarization";

const chamarMaritacaTermoMock = vi.fn();

vi.mock("./maritaca", () => ({
  chamarMaritacaTermo: (...args: unknown[]) => chamarMaritacaTermoMock(...args),
}));

import { gerarTermoAudiencia } from "./service";

const metadata = {
  numeroProcesso: "1004354-87.2026.4.01.3100",
  vara: "JEF Itinerante",
  nomeJuiz: "JUCÉLIO FLEURY NETO",
  partes: "Maria vs INSS",
  classeProcessual: "Procedimento Comum",
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
];

const stubTermo = {
  tipoSentenca: "extincao_sem_merito",
  presentes: { juiz: "JUCÉLIO FLEURY NETO" },
  resumoFatos: "Resumo fiel da instrução.",
  dispositivo: ["a) extingo o feito sem resolução do mérito"],
  markdown: "# TERMO\n\nConteúdo.",
};

describe("gerarTermoAudiencia", () => {
  beforeEach(() => {
    chamarMaritacaTermoMock.mockReset();
    chamarMaritacaTermoMock.mockResolvedValue(stubTermo);
  });

  it("chama Maritaca com system + user prompts", async () => {
    await gerarTermoAudiencia({
      metadata,
      segmentos,
      fallbackTexto: "texto bruto",
    });

    expect(chamarMaritacaTermoMock).toHaveBeenCalledTimes(1);
    const args = chamarMaritacaTermoMock.mock.calls[0][0];
    expect(args.systemPrompt).toBeTypeOf("string");
    expect(args.systemPrompt.length).toBeGreaterThan(0);
    expect(args.userPrompt).toBeTypeOf("string");
    expect(args.userPrompt.length).toBeGreaterThan(0);
  });

  it("inclui metadados do processo no user prompt", async () => {
    await gerarTermoAudiencia({
      metadata,
      segmentos,
      fallbackTexto: "",
    });
    const { userPrompt } = chamarMaritacaTermoMock.mock.calls[0][0];
    expect(userPrompt).toContain(metadata.numeroProcesso);
    expect(userPrompt).toContain(metadata.vara);
    expect(userPrompt).toContain(metadata.nomeJuiz);
  });

  it("inclui segmentos diarizados no user prompt", async () => {
    await gerarTermoAudiencia({
      metadata,
      segmentos,
      fallbackTexto: "",
    });
    const { userPrompt } = chamarMaritacaTermoMock.mock.calls[0][0];
    expect(userPrompt).toContain("[JUIZ] Está aberta a audiência.");
    expect(userPrompt).toContain("[PARTE] Boa tarde, excelência.");
  });

  it("usa fallbackTexto quando segmentos vazios", async () => {
    await gerarTermoAudiencia({
      metadata,
      segmentos: [],
      fallbackTexto: "Texto bruto da transcrição.",
    });
    const { userPrompt } = chamarMaritacaTermoMock.mock.calls[0][0];
    expect(userPrompt).toContain("Texto bruto da transcrição.");
  });

  it("retorna o termo estruturado vindo da Maritaca", async () => {
    const result = await gerarTermoAudiencia({
      metadata,
      segmentos,
      fallbackTexto: "",
    });
    expect(result).toBe(stubTermo);
  });

  it("propaga erros da Maritaca", async () => {
    chamarMaritacaTermoMock.mockRejectedValueOnce(new Error("boom"));
    await expect(
      gerarTermoAudiencia({ metadata, segmentos, fallbackTexto: "" })
    ).rejects.toThrow("boom");
  });
});
