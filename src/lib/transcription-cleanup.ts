import type { TranscriptSegment } from "@/lib/transcription-diarization";

const DEFAULT_MAX_CYCLE_LEN = 5;
// Fala real repete pouco ("Sim." em duas respostas, uma pergunta que não foi ouvida);
// um loop repete sem parar. Quanto mais curto o trecho, mais repetições são exigidas.
const MIN_REPEATS_LONG_CYCLE = 3;
const MIN_REPEATS_SHORT_CYCLE = 4;
const LONG_CYCLE_MIN_WORDS = 5;

function normalizeText(text: string | undefined): string {
  if (!text) return "";
  return text.toLowerCase().replace(/[\s\W]+/g, " ").trim();
}

// Hallucinations recorrentes do Whisper-large-v3 (especialmente em PT-BR):
// frases vindas dos dados de treino do YouTube/legendagem que o modelo emite
// quando encontra silêncio prolongado ou áudio inintelígivel. Não são pegas
// pelos detectores de ciclo porque aparecem APENAS UMA VEZ na saída.
//
// Fontes:
//   - github.com/openai/whisper/discussions/679
//   - github.com/openai/whisper/discussions/1606
//   - reports da comunidade Whisper.cpp em PT-BR
//
// Registro judicial: na dúvida, o segmento fica. Os padrões exigem a frase típica
// inteira, porque "curta", "comente" ou "obrigado" também são fala real.
const WHISPER_HALLUCINATION_PATTERNS: RegExp[] = [
  // Despedidas de YouTube
  /^(muito\s+)?obrigad[oa]s?\s+(a\s+todos\s+)?por\s+(assistir(em)?|ver(em)?\s+(o|este|esse)\s+v[íi]deo)(\s+(ao|o|este|esse)\s+v[íi]deo)?[\s.!?…]*$/i,
  /^at[ée]\s+(o|a)\s+pr[óo]xim[oa]\s+(v[íi]deo|epis[óo]dio)[\s.!?…]*$/i,
  /\b(curtam?\s+((o|este|esse)\s+)?v[íi]deo|curtam?\s+e\s+(se\s+)?inscrev|inscrev[ae]m?-?se\s+no\s+canal|deixem?\s+(o\s+|seu\s+)like|comentem?\s+(aqui\s+)?abaixo)/i,
  // Créditos de legendagem (corpus de treino)
  /legendas?\s+(da|pela|por)\s+comunidade\s+amara/i,
  /^as\s+legendas\s+em\s+portugu[êe]s/i,
  /^tradu(ç|c)[ãa]o\s+e\s+legenda(gem|s)\s+(de|por)/i,
  /^sub(títul|titul)os?\s+(por|de|pela)\s+\w+/i,
  // Marcadores não-fala (mesmo com --suppress-nst alguns sobrevivem), sem nenhuma fala junto
  /^[♪♫\s]+$/,
  /^(\[\s*(m[úu]sica|aplausos?|risos?|silêncio|barulho|tosse|music|applause|laughter|silence)\s*\][\s.]*)+$/i,
  /^(\(\s*(m[úu]sica|aplausos?|risos?|silêncio|barulho|music|applause|laughter|silence)\s*\)[\s.]*)+$/i,
  // Inglês (corpus de treino vaza)
  /^thank\s+you\s+for\s+watching/i,
  /^subscribe\s+(to\s+)?(my\s+|the\s+)?channel/i,
  /^(please\s+)?like\s+and\s+subscribe/i,
];

/**
 * Remove segmentos cujo texto inteiro casa com padrões conhecidos de
 * hallucination do Whisper. Aplique ANTES de `collapseHallucinationCycles`
 * para que ciclos contendo essas frases sejam detectados após a remoção.
 */
export function filterWhisperHallucinations(
  segments: TranscriptSegment[]
): TranscriptSegment[] {
  return segments.filter((s) => {
    const text = (s.text ?? "").trim();
    if (!text) return false;
    return !WHISPER_HALLUCINATION_PATTERNS.some((re) => re.test(text));
  });
}

export interface CollapseCyclesOptions {
  maxCycleLen?: number;
  minRepeats?: number;
}

/**
 * Detecta e colapsa ciclos de repetição de hallucination do Whisper.
 *
 * Whisper (large-v3 em particular) entra em loops onde uma sequência curta
 * de segmentos é repetida dezenas/centenas de vezes — geralmente quando
 * encontra silêncio prolongado, áudio de baixa qualidade ou trechos
 * inintelígiveis. O texto repetido domina a transcrição e mascara o
 * conteúdo real.
 *
 * Para cada posição, busca o maior ciclo (1..maxCycleLen) que se repete
 * o suficiente: 3 vezes, ou 4 se o ciclo tem menos de 5 palavras (ou `minRepeats`,
 * se informado). Quando encontra, emite UM ciclo e pula o resto. Cobre tanto repetição direta (A A A → A) quanto ciclos
 * (A B C A B C → A B C).
 */
export function collapseHallucinationCycles(
  segments: TranscriptSegment[],
  opts: CollapseCyclesOptions = {}
): TranscriptSegment[] {
  const maxCycleLen = opts.maxCycleLen ?? DEFAULT_MAX_CYCLE_LEN;

  if (segments.length < 2) return segments;

  const norms = segments.map((s) => normalizeText(s.text));
  const out: TranscriptSegment[] = [];

  let i = 0;
  while (i < segments.length) {
    let bestCycleLen = 0;
    let bestEnd = i;

    for (let k = 1; k <= maxCycleLen; k++) {
      const unit = norms.slice(i, i + k);
      if (unit.every((t) => t.length === 0)) continue;
      const unitWords = unit.join(" ").split(" ").filter(Boolean).length;
      const minRepeats =
        opts.minRepeats ??
        (unitWords >= LONG_CYCLE_MIN_WORDS ? MIN_REPEATS_LONG_CYCLE : MIN_REPEATS_SHORT_CYCLE);
      if (i + k * minRepeats > segments.length) continue;

      let j = i + k;
      while (j + k <= segments.length) {
        let match = true;
        for (let z = 0; z < k; z++) {
          if (norms[j + z] !== norms[i + z]) {
            match = false;
            break;
          }
        }
        if (!match) break;
        j += k;
      }

      const repeats = (j - i) / k;
      if (repeats >= minRepeats && j > bestEnd) {
        bestCycleLen = k;
        bestEnd = j;
      }
    }

    if (bestCycleLen > 0) {
      for (let z = 0; z < bestCycleLen; z++) out.push(segments[i + z]);
      i = bestEnd;
    } else {
      out.push(segments[i]);
      i += 1;
    }
  }

  return out;
}

function jaccardWords(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

export interface CollapseNearDuplicatesOptions {
  /** Threshold de Jaccard de palavras (0..1) para considerar near-duplicate. */
  threshold?: number;
  /** Tamanho mínimo (em palavras) para o segmento ser elegível à comparação.
   * Segmentos curtos (Sim/Não/etc.) são sempre preservados. */
  minWords?: number;
  /** Quantos segmentos seguidos parecidos caracterizam um loop. */
  minRun?: number;
}

function isNearDuplicate(a: string[], b: string[], threshold: number): boolean {
  if (jaccardWords(a, b) < threshold) return false;
  // Um dos textos precisa conter o outro. Se cada um tem palavra própria
  // ("em 2010" / "em 2011"), são falas diferentes, não um loop.
  const sa = new Set(a);
  const sb = new Set(b);
  return a.every((w) => sb.has(w)) || b.every((w) => sa.has(w));
}

/**
 * Remove resíduos de hallucination loop que sobrevivem ao colapso de ciclos
 * porque a quebra de cues do whisper.cpp distribui o mesmo texto entre
 * segmentos com fingerprints diferentes (ex.: "Ele falou para X" / "Ele
 * falou para X para Y" / "Ele falou para X para Y para Z" — todos prefixos
 * uns dos outros).
 *
 * Só age em uma sequência de `minRun` ou mais segmentos longos IMEDIATAMENTE
 * seguidos e parecidos: mantém o primeiro e descarta o resto. Qualquer fala no
 * meio interrompe a sequência, pois a mesma resposta a perguntas diferentes
 * ("Não me recordo disso") é fala real.
 */
export function collapseNearDuplicateLongSegments(
  segments: TranscriptSegment[],
  opts: CollapseNearDuplicatesOptions = {}
): TranscriptSegment[] {
  const threshold = opts.threshold ?? 0.7;
  const minWords = opts.minWords ?? 5;
  const minRun = opts.minRun ?? 3;

  if (segments.length < 2) return segments;

  const tokens = segments.map((s) =>
    normalizeText(s.text)
      .split(" ")
      .filter((w) => w.length > 0)
  );
  const out: TranscriptSegment[] = [];

  let i = 0;
  while (i < segments.length) {
    let end = i + 1;
    if (tokens[i].length >= minWords) {
      while (
        end < segments.length
        && tokens[end].length >= minWords
        && isNearDuplicate(tokens[end - 1], tokens[end], threshold)
      ) {
        end += 1;
      }
    }

    if (end - i >= minRun) {
      out.push(segments[i]);
    } else {
      out.push(...segments.slice(i, end));
    }
    i = end;
  }

  return out;
}

const DEFAULT_INTRA_NGRAM_MAX_LEN = 8;
const DEFAULT_INTRA_NGRAM_MIN_REPEATS = 3;
// "muito muito muito" e "não não não" são fala real; loop de 1 ou 2 palavras repete mais.
const INTRA_SHORT_NGRAM_MAX_LEN = 2;
const INTRA_SHORT_NGRAM_MIN_REPEATS = 5;

const NUMBER_TOKEN =
  /^(\d+|zero|um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez)[.,;:!?]*$/i;

/**
 * Colapsa repetição imediata de n-gramas DENTRO do texto de uma string.
 *
 * `collapseHallucinationCycles` opera em granularidade de segmento. Quando
 * o engine entrega o loop inteiro num único segmento — comum no Chirp 3
 * com áudio de baixa confiança ("o que que é o que que é..." x 200) — o
 * colapso por segmento não enxerga.
 *
 * Para cada n de `maxN` até 1, procura sequências de palavras que se
 * repetem imediatamente >= `minRepeats` vezes e reduz para 1 ocorrência.
 * Mantém pontuação adjacente. Sequências só de números nunca são colapsadas, porque
 * "zero zero zero" pode ser parte de um CPF ou de um número de processo ditado.
 */
export function collapseRepeatedNgramsInText(
  text: string,
  opts: { maxN?: number; minRepeats?: number } = {}
): string {
  const maxN = opts.maxN ?? DEFAULT_INTRA_NGRAM_MAX_LEN;
  const minRepeats = opts.minRepeats ?? DEFAULT_INTRA_NGRAM_MIN_REPEATS;

  if (!text) return text;
  const tokens = text.split(/\s+/);
  if (tokens.length < minRepeats) return text;

  // Tenta n decrescente para preferir colapsar ciclos longos antes de curtos.
  for (let n = Math.min(maxN, Math.floor(tokens.length / minRepeats)); n >= 1; n--) {
    const out: string[] = [];
    let i = 0;
    let collapsed = false;
    const requiredRepeats =
      n <= INTRA_SHORT_NGRAM_MAX_LEN && opts.minRepeats === undefined
        ? INTRA_SHORT_NGRAM_MIN_REPEATS
        : minRepeats;

    while (i < tokens.length) {
      if (i + n * requiredRepeats > tokens.length) {
        out.push(tokens[i]);
        i += 1;
        continue;
      }
      const ngram = tokens.slice(i, i + n).map((t) => t.toLowerCase());
      if (ngram.every((t) => NUMBER_TOKEN.test(t))) {
        out.push(tokens[i]);
        i += 1;
        continue;
      }
      let repeats = 1;
      let j = i + n;
      while (j + n <= tokens.length) {
        const next = tokens.slice(j, j + n).map((t) => t.toLowerCase());
        if (ngram.every((w, k) => w === next[k])) {
          repeats += 1;
          j += n;
        } else {
          break;
        }
      }
      if (repeats >= requiredRepeats) {
        for (let z = 0; z < n; z++) out.push(tokens[i + z]);
        i = j;
        collapsed = true;
      } else {
        out.push(tokens[i]);
        i += 1;
      }
    }

    if (collapsed) {
      return out.join(" ");
    }
  }

  return text;
}

/** Aplica `collapseRepeatedNgramsInText` ao `text` de cada segmento. */
export function collapseRepetitionsWithinSegments(
  segments: TranscriptSegment[]
): TranscriptSegment[] {
  return segments.map((s) => {
    const cleanedText = collapseRepeatedNgramsInText(s.text);
    if (cleanedText === s.text) return s;
    return { ...s, text: cleanedText };
  });
}

/**
 * Mergea segmentos consecutivos com o mesmo `speakerId` upstream.
 *
 * Engines como Chirp 3 fragmentam segmentos a cada ~15s mesmo quando o
 * speaker é o mesmo. Esse split é artefato do parser, não tem valor
 * semântico — uma fala única do juiz vira 3-4 segmentos. Pior: hallucinations
 * cíclicas se espalham por essas fronteiras e escapam do detector intra-
 * segmento.
 *
 * Pré-condição: segmentos com `speakerId` upstream populado (chirp_3, etc.).
 * Para engines sem speakerId (whisper local), é no-op.
 */
export function mergeConsecutiveSameSpeakerSegments(
  segments: TranscriptSegment[]
): TranscriptSegment[] {
  if (segments.length < 2) return segments;

  const out: TranscriptSegment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (
      last &&
      last.speakerId &&
      s.speakerId &&
      last.speakerId === s.speakerId
    ) {
      const lastText = (last.text ?? "").trim();
      const curText = (s.text ?? "").trim();
      const mergedText =
        lastText && curText ? `${lastText} ${curText}` : lastText || curText;
      out[out.length - 1] = {
        ...last,
        text: mergedText,
        endMs: s.endMs ?? last.endMs,
      };
    } else {
      out.push(s);
    }
  }
  return out;
}

export function rebuildTextFromSegments(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => (s.text || "").trim())
    .filter((t) => t.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
