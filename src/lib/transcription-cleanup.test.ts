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

  it("colapsa ciclo de 2 quando repete o bastante para ser loop (A B × 4 → A B)", () => {
    const input = [
      seg("Sim", 0, 1000),
      seg("Não", 1000, 2000),
      seg("Sim", 2000, 3000),
      seg("Não", 3000, 4000),
      seg("Sim", 4000, 5000),
      seg("Não", 5000, 6000),
      seg("Sim", 6000, 7000),
      seg("Não", 7000, 8000),
      seg("Tchau", 8000, 9000),
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
    const out = collapseHallucinationCycles(input, { minRepeats: 2 });
    expect(out.map((s) => s.text)).toEqual(["A", "B"]);
  });

  it("preserva os segmentos originais (mesma referência)", () => {
    const a = seg("X", 0, 1000);
    const b = seg("X", 1000, 2000);
    const c = seg("Y", 2000, 3000);
    const out = collapseHallucinationCycles([a, b, c], { minRepeats: 2 });
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

  it("deixa para o colapso de ciclos o loop intercalado com falas curtas", () => {
    const pergunta = "A senhora gastou quanto para levantar a casa para os filhos?";
    const input = [pergunta, "Não.", "para o filho."]
      .concat(pergunta, "Não.", "para o filho.", pergunta, "Não.", "para o filho.")
      .map((text, i) => seg(text, i * 1000, i * 1000 + 900));

    expect(collapseNearDuplicateLongSegments(input)).toHaveLength(9);
    expect(collapseHallucinationCycles(input).map((s) => s.text)).toEqual([
      pergunta,
      "Não.",
      "para o filho.",
    ]);
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

describe("limpeza não apaga fala legítima do registro", () => {
  const texts = (segments: TranscriptSegment[]) => segments.map((s) => s.text);
  const list = (...items: string[]) => items.map((text, i) => seg(text, i * 1000, i * 1000 + 900));

  it.each([
    "A audiência foi curta.",
    "Comente sobre o laudo pericial.",
    "Comente o vídeo apresentado pela defesa.",
    "Obrigado.",
    "[risos] Não é bem assim, doutor.",
    "(música) Ele tocava música na igreja.",
    "Obrigado por ver isso, doutor.",
    "Até o próximo encontro, a senhora fica intimada.",
    "Ele pediu a tradução e legendas por escrito.",
  ])("filtro mantém %j", (text) => {
    expect(texts(filterWhisperHallucinations(list(text)))).toEqual([text]);
  });

  it.each([
    "Obrigado por assistir ao vídeo!",
    "Curtam e se inscrevam.",
    "Curta o vídeo e deixe seu like.",
    "Inscreva-se no canal.",
    "[Música] [Aplausos]",
  ])("filtro continua removendo %j", (text) => {
    expect(filterWhisperHallucinations(list(text))).toEqual([]);
  });

  it("mantém respostas curtas repetidas poucas vezes", () => {
    const input = list("O senhor mora lá?", "Sim.", "Sim.", "Trabalhou?", "Sim.", "Não.", "Sim.", "Não.");
    expect(collapseHallucinationCycles(input)).toEqual(input);
  });

  it("mantém pergunta repetida duas vezes, como quando alguém não ouviu", () => {
    const input = list("O senhor confirma o que disse antes?", "O senhor confirma o que disse antes?");
    expect(collapseHallucinationCycles(input)).toEqual(input);
  });

  it("continua colapsando loop curto longo e loop de frase", () => {
    const shortLoop = list(...Array(20).fill("Sim."), "Fim da fala");
    expect(texts(collapseHallucinationCycles(shortLoop))).toEqual(["Sim.", "Fim da fala"]);

    const sentence = "A senhora gastou quanto para levantar a casa?";
    const sentenceLoop = list(sentence, sentence, sentence, "Fim da fala");
    expect(texts(collapseHallucinationCycles(sentenceLoop))).toEqual([sentence, "Fim da fala"]);
  });

  it("mantém perguntas parecidas que diferem em um dado", () => {
    const input = list(
      "A senhora trabalhou na roça em 2010?",
      "Trabalhei sim, excelência, por muitos anos.",
      "A senhora trabalhou na roça em 2011?",
      "A senhora trabalhou na roça em 2012?"
    );
    expect(collapseNearDuplicateLongSegments(input)).toEqual(input);
  });

  it("mantém a mesma resposta dada a perguntas diferentes", () => {
    const answer = "Não me recordo disso, excelência.";
    const input = list(
      answer,
      "O senhor recebeu o benefício em casa?",
      answer,
      "E depois?",
      answer
    );
    expect(collapseNearDuplicateLongSegments(input)).toEqual(input);
  });

  it("mantém duas falas seguidas parecidas, sem indício de loop", () => {
    const input = list(
      "A senhora trabalhou na roça naquele ano?",
      "A senhora trabalhou na roça naquele ano todo?"
    );
    expect(collapseNearDuplicateLongSegments(input)).toEqual(input);
  });

  it.each([
    "O CPF é zero zero zero um dois três",
    "o número 0 0 0 1 2 3",
    "foi em 2010 2010 2010",
    "muito muito muito obrigado",
    "não não não eu não fui",
  ])("colapso interno mantém %j", (text) => {
    expect(collapseRepeatedNgramsInText(text)).toBe(text);
  });

  it("colapso interno nunca altera sequência de números, mesmo longa", () => {
    const text = "zero ".repeat(20).trim();
    expect(collapseRepeatedNgramsInText(text)).toBe(text);
  });

  it("audiência completa: mantém toda a fala real e remove só o loop", () => {
    const fala = [
      "Está aberta a audiência.",
      "O CPF da senhora é zero zero zero um dois três?",
      "Sim.",
      "Sim.",
      "A senhora trabalhou na roça em 2010?",
      "Não me recordo disso, excelência.",
      "A senhora trabalhou na roça em 2011?",
      "Não me recordo disso, excelência.",
      "[risos] Não é bem assim, doutor.",
      "Obrigado.",
    ];
    const loop = Array(30).fill("E ele falou para mim que ia pagar o filho");
    const crescente = [
      "Ele disse para mim que a partir de janeiro",
      "Ele disse para mim que a partir de janeiro ia pagar",
      "Ele disse para mim que a partir de janeiro ia pagar o filho",
    ];
    const lixo = ["Legendas pela comunidade Amara.org", "[Música]", "Obrigado por assistir!"];
    const input = list(...fala, ...loop, ...crescente, ...lixo, "Encerrada a audiência.");

    const out = collapseNearDuplicateLongSegments(
      collapseHallucinationCycles(
        filterWhisperHallucinations(
          collapseRepetitionsWithinSegments(mergeConsecutiveSameSpeakerSegments(input))
        )
      )
    );

    expect(texts(out)).toEqual([
      ...fala,
      "E ele falou para mim que ia pagar o filho",
      crescente[0],
      "Encerrada a audiência.",
    ]);
  });
});
