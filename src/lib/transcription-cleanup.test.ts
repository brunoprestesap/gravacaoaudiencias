import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@/lib/transcription-diarization";
import {
  collapseHallucinationCycles,
  collapseNearDuplicateLongSegments,
  collapseRepeatedNgramsInText,
  collapseRepetitionsWithinSegments,
  filterWhisperHallucinations,
  mergeConsecutiveSameSpeakerSegments,
  rebuildTextFromSegments,
} from "./transcription-cleanup";

const seg = (text: string, startMs: number, endMs: number, id = `s${startMs}`): TranscriptSegment => ({
  id,
  text,
  offsetMs: startMs,
  startMs,
  endMs,
  createdAt: "2026-05-04T00:00:00.000Z",
});

describe("collapseHallucinationCycles", () => {
  it("preserva sequência sem repetição", () => {
    const input = [seg("Bom dia", 0, 1000), seg("Como vai", 1000, 2000), seg("Tudo bem", 2000, 3000)];
    expect(collapseHallucinationCycles(input)).toHaveLength(3);
  });

  it("colapsa repetição direta de 1 segmento (A A A A → A)", () => {
    const input = [
      seg("Por mais?", 0, 1000),
      seg("Por mais?", 1000, 2000),
      seg("Por mais?", 2000, 3000),
      seg("Por mais?", 3000, 4000),
      seg("Próxima fala", 4000, 5000),
    ];
    const out = collapseHallucinationCycles(input);
    expect(out.map((s) => s.text)).toEqual(["Por mais?", "Próxima fala"]);
  });

  it("colapsa ciclo de 2 (A B A B A B → A B)", () => {
    const input = [
      seg("Sim", 0, 1000),
      seg("Não", 1000, 2000),
      seg("Sim", 2000, 3000),
      seg("Não", 3000, 4000),
      seg("Sim", 4000, 5000),
      seg("Não", 5000, 6000),
      seg("Tchau", 6000, 7000),
    ];
    const out = collapseHallucinationCycles(input);
    expect(out.map((s) => s.text)).toEqual(["Sim", "Não", "Tchau"]);
  });

  it("colapsa ciclo de 3 (A B C A B C A B C → A B C)", () => {
    const input = [
      seg("Ele falou", 0, 1000),
      seg("para o filho", 1000, 2000),
      seg("Não", 2000, 3000),
      seg("Ele falou", 3000, 4000),
      seg("para o filho", 4000, 5000),
      seg("Não", 5000, 6000),
      seg("Ele falou", 6000, 7000),
      seg("para o filho", 7000, 8000),
      seg("Não", 8000, 9000),
      seg("Algo novo", 9000, 10000),
    ];
    const out = collapseHallucinationCycles(input);
    expect(out.map((s) => s.text)).toEqual(["Ele falou", "para o filho", "Não", "Algo novo"]);
  });

  it("não colapsa quando o ciclo não atinge minRepeats", () => {
    const input = [
      seg("A", 0, 1000),
      seg("B", 1000, 2000),
      seg("A", 2000, 3000),
      seg("Outra coisa", 3000, 4000),
    ];
    expect(collapseHallucinationCycles(input)).toHaveLength(4);
  });

  it("ignora variações de pontuação/case ao detectar ciclo", () => {
    const input = [
      seg("Sim.", 0, 1000),
      seg("Sim,", 1000, 2000),
      seg("SIM", 2000, 3000),
      seg("sim!", 3000, 4000),
      seg("Diferente", 4000, 5000),
    ];
    const out = collapseHallucinationCycles(input);
    expect(out.map((s) => s.text)).toEqual(["Sim.", "Diferente"]);
  });

  it("ignora pattern de só strings vazias", () => {
    const input = [seg("", 0, 100), seg("", 100, 200), seg("Real", 200, 1000)];
    expect(collapseHallucinationCycles(input)).toHaveLength(3);
  });

  it("prefere o ciclo que cobre mais (maior cycleLen)", () => {
    // A B A B A B → ambíguo: cycleLen=1 com A repetindo? Não, B intercala. cycleLen=2 cobre tudo.
    const input = [
      seg("A", 0, 1000),
      seg("B", 1000, 2000),
      seg("A", 2000, 3000),
      seg("B", 3000, 4000),
      seg("A", 4000, 5000),
      seg("B", 5000, 6000),
    ];
    const out = collapseHallucinationCycles(input);
    expect(out.map((s) => s.text)).toEqual(["A", "B"]);
  });

  it("preserva os segmentos originais (mesma referência)", () => {
    const a = seg("X", 0, 1000);
    const b = seg("X", 1000, 2000);
    const c = seg("Y", 2000, 3000);
    const out = collapseHallucinationCycles([a, b, c]);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(c);
  });
});

describe("collapseNearDuplicateLongSegments", () => {
  it("preserva segmentos curtos repetidos (Sim/Não)", () => {
    const input = [
      seg("Sim.", 0, 1000),
      seg("E ele tem autismo?", 1000, 4000),
      seg("Sim.", 4000, 5000),
      seg("Quantos anos tem?", 5000, 8000),
      seg("Sim.", 8000, 9000),
    ];
    const out = collapseNearDuplicateLongSegments(input);
    expect(out).toHaveLength(5);
  });

  it("colapsa near-duplicates longos (mesmo prefixo + sufixos diferentes)", () => {
    const input = [
      seg("Ele falou para mim que a partir do mês de janeiro ele ia começar", 0, 3000),
      seg("Ele falou para mim que a partir do mês de janeiro ele ia começar a pagar", 3000, 6000),
      seg("Ele falou para mim que a partir do mês de janeiro ele ia começar a pagar para o filho", 6000, 9000),
      seg("Resposta diferente sobre outro tópico totalmente distinto", 9000, 12000),
    ];
    const out = collapseNearDuplicateLongSegments(input);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe(input[0].text);
    expect(out[1].text).toBe(input[3].text);
  });

  it("colapsa near-duplicates separados por curtos (cycle residual)", () => {
    const input = [
      seg("A senhora gastou quanto para levantar a casa para os filhos?", 0, 3000),
      seg("Não.", 3000, 4000),
      seg("para o filho.", 4000, 5000),
      seg("A senhora gastou quanto para levantar a casa para os filhos?", 5000, 8000),
      seg("Não.", 8000, 9000),
      seg("para o filho.", 9000, 10000),
    ];
    const out = collapseNearDuplicateLongSegments(input);
    expect(out.filter((s) => s.text.startsWith("A senhora"))).toHaveLength(1);
  });

  it("não altera lista vazia ou unitária", () => {
    expect(collapseNearDuplicateLongSegments([])).toEqual([]);
    const single = [seg("oi", 0, 1000)];
    expect(collapseNearDuplicateLongSegments(single)).toEqual(single);
  });
});

describe("rebuildTextFromSegments", () => {
  it("junta texto com um espaço, sem duplicatas de espaço", () => {
    const segs = [
      seg("  Bom dia ", 0, 1000),
      seg("Como vai?", 1000, 2000),
      seg("", 2000, 3000),
      seg("Tudo bem.", 3000, 4000),
    ];
    expect(rebuildTextFromSegments(segs)).toBe("Bom dia Como vai? Tudo bem.");
  });

  it("retorna string vazia para lista vazia", () => {
    expect(rebuildTextFromSegments([])).toBe("");
  });
});

describe("filterWhisperHallucinations", () => {
  it("preserva fala normal", () => {
    const input = [
      seg("Aberta a audiência", 0, 2000),
      seg("Pode falar a defesa", 2000, 4000),
    ];
    expect(filterWhisperHallucinations(input)).toHaveLength(2);
  });

  it("remove despedidas de YouTube em PT-BR", () => {
    const input = [
      seg("Conteúdo real da audiência.", 0, 3000),
      seg("Obrigado por assistir!", 3000, 5000),
      seg("Muito obrigado por assistirem.", 5000, 7000),
      seg("Obrigado.", 7000, 8000),
      seg("Até o próximo vídeo.", 8000, 10000),
    ];
    const out = filterWhisperHallucinations(input);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Conteúdo real da audiência.");
  });

  it("remove créditos de legendagem (Amara, tradução)", () => {
    const input = [
      seg("Decisão registrada nos autos.", 0, 3000),
      seg("Legendas pela comunidade Amara.org", 3000, 5000),
      seg("As legendas em português pela comunidade Amara.", 5000, 7000),
      seg("Tradução e legendagem por João Silva", 7000, 9000),
    ];
    const out = filterWhisperHallucinations(input);
    expect(out).toHaveLength(1);
  });

  it("remove marcadores não-fala mesmo com suppress-nst", () => {
    const input = [
      seg("Defesa apresenta documentos.", 0, 3000),
      seg("[Música]", 3000, 5000),
      seg("(música)", 5000, 7000),
      seg("[applause]", 7000, 9000),
      seg("♪ ♪", 9000, 10000),
    ];
    const out = filterWhisperHallucinations(input);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Defesa apresenta documentos.");
  });

  it("remove vazamentos do corpus em inglês", () => {
    const input = [
      seg("A testemunha confirma", 0, 2000),
      seg("Thank you for watching!", 2000, 4000),
      seg("Subscribe to my channel", 4000, 6000),
      seg("Please like and subscribe", 6000, 8000),
    ];
    const out = filterWhisperHallucinations(input);
    expect(out).toHaveLength(1);
  });

  it("não remove segmentos que apenas mencionam termos parciais", () => {
    const input = [
      seg("A testemunha disse obrigado e saiu.", 0, 3000),
      seg("Solicito a tradução do documento.", 3000, 5000),
    ];
    expect(filterWhisperHallucinations(input)).toHaveLength(2);
  });

  it("descarta segmentos com texto vazio", () => {
    const input = [seg("", 0, 1000), seg("Real", 1000, 2000), seg("   ", 2000, 3000)];
    expect(filterWhisperHallucinations(input)).toHaveLength(1);
  });
});

describe("collapseRepeatedNgramsInText", () => {
  it("colapsa repetição imediata de n-grama de 4 palavras", () => {
    const input =
      "Deixou com inflamação. " +
      "o que que é o que que é o que que é o que que é o que que é " +
      "Próxima fala.";
    const out = collapseRepeatedNgramsInText(input);
    // Deve manter o texto inicial e final, com "o que que é" só uma vez
    expect(out).toContain("Deixou com inflamação.");
    expect(out).toContain("Próxima fala.");
    const matches = out.match(/o que que é/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(2); // tolera 1-2 ocorrências legítimas
  });

  it("colapsa repetição de palavra única (A A A A → A)", () => {
    const input = "isso isso isso isso isso pronto";
    const out = collapseRepeatedNgramsInText(input);
    expect(out).toBe("isso pronto");
  });

  it("preserva texto sem repetição", () => {
    const input = "Bom dia Senhor Juiz tudo certo";
    expect(collapseRepeatedNgramsInText(input)).toBe(input);
  });

  it("não colapsa repetições legítimas curtas (< minRepeats)", () => {
    const input = "muito muito bom";
    expect(collapseRepeatedNgramsInText(input)).toBe(input);
  });
});

describe("collapseRepetitionsWithinSegments", () => {
  it("aplica colapso ao texto de cada segmento", () => {
    const input = [
      seg("oi", 0, 1000),
      seg(
        "Tá me dando um Deixou com inflamação. " +
          "o que que é o que que é o que que é o que que é o que que é o que que é",
        1000,
        2000
      ),
    ];
    const out = collapseRepetitionsWithinSegments(input);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("oi");
    expect(out[1].text).not.toMatch(/(o que que é\s+){4,}/);
  });

  it("preserva segmento quando não há repetição", () => {
    const input = [seg("Bom dia", 0, 1000)];
    const out = collapseRepetitionsWithinSegments(input);
    expect(out[0]).toBe(input[0]); // identidade preservada
  });
});

describe("mergeConsecutiveSameSpeakerSegments", () => {
  const segS = (text: string, startMs: number, endMs: number, speakerId?: string): TranscriptSegment => ({
    id: `s${startMs}`,
    text,
    offsetMs: startMs,
    startMs,
    endMs,
    speakerId,
    createdAt: "2026-05-04T00:00:00.000Z",
  });

  it("mergea dois segmentos consecutivos do mesmo speakerId", () => {
    const input = [
      segS("Tá me dando um deixou com inflamação. O que que é o que que é o que", 0, 15000, "1"),
      segS("que é o que que é o que que é o que que", 15000, 18000, "1"),
    ];
    const out = mergeConsecutiveSameSpeakerSegments(input);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain("Tá me dando");
    expect(out[0].text).toContain("o que que é");
    expect(out[0].startMs).toBe(0);
    expect(out[0].endMs).toBe(18000);
    expect(out[0].speakerId).toBe("1");
  });

  it("não mergea quando speakerId muda", () => {
    const input = [
      segS("juiz fala", 0, 1000, "1"),
      segS("parte responde", 1000, 2000, "2"),
    ];
    const out = mergeConsecutiveSameSpeakerSegments(input);
    expect(out).toHaveLength(2);
  });

  it("é no-op quando segmentos não têm speakerId", () => {
    const input = [
      segS("frase 1", 0, 1000),
      segS("frase 2", 1000, 2000),
    ];
    const out = mergeConsecutiveSameSpeakerSegments(input);
    expect(out).toHaveLength(2);
  });

  it("permite que um loop quebrado entre 2 segmentos seja colapsado depois", () => {
    const input = [
      segS("Pregabalina. O que que é o que que é o que", 0, 15000, "1"),
      segS("que é o que que é o que que é", 15000, 30000, "1"),
    ];
    const merged = mergeConsecutiveSameSpeakerSegments(input);
    const cleaned = collapseRepetitionsWithinSegments(merged);
    expect(cleaned).toHaveLength(1);
    const matches = cleaned[0].text.match(/o que que é/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(2);
  });
});
