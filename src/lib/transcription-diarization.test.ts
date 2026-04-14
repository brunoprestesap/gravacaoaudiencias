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

  it("infere juiz e parte em diálogo de audiência (padrões de fala)", () => {
    const segments: TranscriptSegment[] = [
      {
        id: "1",
        text: "pelo que ela me falou, parece que é apenas uma que tem um parentesco de quarto grau que eu poderia ouvir com testemunha.",
        offsetMs: 0,
        createdAt: new Date().toISOString(),
      },
      {
        id: "2",
        text: "Dona Cristiane, tudo bem com a senhora? A senhora está me ouvindo bem?",
        offsetMs: 5000,
        createdAt: new Date().toISOString(),
      },
      {
        id: "3",
        text: "Eu conheci ele por mim, envolvi com ele, né?",
        offsetMs: 10_000,
        createdAt: new Date().toISOString(),
      },
      {
        id: "4",
        text: "O INSS não contesta a existência da união.",
        offsetMs: 15_000,
        createdAt: new Date().toISOString(),
      },
    ];

    const diarized = diarizeSegmentsByRole(segments);
    expect(diarized[0].role).toBe("JUIZ");
    expect(diarized[1].role).toBe("JUIZ");
    expect(diarized[2].role).toBe("PARTE");
    expect(diarized[3].role).toBe("JUIZ");
  });

  it("juiz ao advogado não é parte; resposta do advogado é PROCURADOR", () => {
    const sharedVoice = {
      pitchMeanHz: 175,
      energyMeanDb: -22,
      pauseRatio: 0.35,
      speechRateApprox: 105,
    } as const;

    const segments: TranscriptSegment[] = [
      {
        id: "1",
        text: "Ô, doutor Edson, se o senhor quiser permanecer de máscara, fica à vontade.",
        offsetMs: 0,
        createdAt: new Date().toISOString(),
        voiceFeatures: { ...sharedVoice },
      },
      {
        id: "2",
        text: "Não, eu prefiro ficar assim, doutora.",
        offsetMs: 5000,
        createdAt: new Date().toISOString(),
        voiceFeatures: { ...sharedVoice },
      },
    ];

    const diarized = diarizeSegmentsByRole(segments);
    expect(diarized[0].role).toBe("JUIZ");
    expect(diarized[1].role).toBe("PROCURADOR");
  });

  it("relato em primeira pessoa da parte não vira JUIZ por voz parecida com o turno anterior", () => {
    const voiceJuiz = {
      pitchMeanHz: 142,
      energyMeanDb: -19,
      pauseRatio: 0.41,
      speechRateApprox: 90,
    } as const;

    const segments: TranscriptSegment[] = [
      {
        id: "1",
        text: "Eu gostaria de saber da senhora, assim, como que começou o relacionamento da senhora com o seu André?",
        offsetMs: 0,
        createdAt: new Date().toISOString(),
        voiceFeatures: { ...voiceJuiz },
      },
      {
        id: "2",
        text: "A casa dele tava em reforma.",
        offsetMs: 5000,
        createdAt: new Date().toISOString(),
        voiceFeatures: { ...voiceJuiz },
      },
    ];

    const diarized = diarizeSegmentsByRole(segments);
    expect(diarized[0].role).toBe("JUIZ");
    expect(diarized[1].role).toBe("PARTE");
  });

  it("preserva parte no meio quando o texto indica relato claro (ilha não colapsa)", () => {
    const v = {
      pitchMeanHz: 168,
      energyMeanDb: -21,
      pauseRatio: 0.36,
      speechRateApprox: 102,
    } as const;

    const segments: TranscriptSegment[] = [
      {
        id: "1",
        text: "Eu gostaria de saber da senhora um pouco mais sobre o pedido.",
        offsetMs: 0,
        createdAt: new Date().toISOString(),
        voiceFeatures: { ...v },
      },
      {
        id: "2",
        text: "Eu conheci ele por mim, envolvi com ele, né?",
        offsetMs: 5000,
        createdAt: new Date().toISOString(),
        voiceFeatures: { ...v },
      },
      {
        id: "3",
        text: "Conta aqui pra mim o que a senhora pôde apurar.",
        offsetMs: 10_000,
        createdAt: new Date().toISOString(),
        voiceFeatures: { ...v },
      },
    ];

    const diarized = diarizeSegmentsByRole(segments);
    expect(diarized[0].role).toBe("JUIZ");
    expect(diarized[1].role).toBe("PARTE");
    expect(diarized[2].role).toBe("JUIZ");
  });

  it("classifica relato da parte com tag 'né?' sem tratar como pergunta do juiz", () => {
    const segments: TranscriptSegment[] = [
      {
        id: "1",
        text: "Nisso, eu já sou uma menina, uma bebezinha, né?",
        offsetMs: 0,
        createdAt: new Date().toISOString(),
        voiceFeatures: { pitchEndLiftHz: 28, pitchMeanHz: 210, energyMeanDb: -22, pauseRatio: 0.3 },
      },
    ];

    const diarized = diarizeSegmentsByRole(segments);
    expect(diarized[0].role).toBe("PARTE");
  });
});
