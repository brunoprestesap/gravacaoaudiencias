import type { TranscriptSegment } from "@/lib/transcription-diarization";

const DEFAULT_MAX_CYCLE_LEN = 5;
const DEFAULT_MIN_REPEATS = 2;

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
const WHISPER_HALLUCINATION_PATTERNS: RegExp[] = [
  // Despedidas de YouTube
  /^(muito\s+)?obrigad[oa]s?\s+(a\s+todos\s+)?(por\s+)?(assistir(em)?|ver|verem)/i,
  /^obrigad[oa]s?\.?$/i,
  /at[ée]\s+(o|a)\s+pr[óo]xim[oa]\s+(v[íi]deo|epis[óo]dio|encontro)/i,
  /(curt(am|a)|inscrev[ae]m?-?se|deixe[m]?\s+seu\s+like|comente[m]?)\b/i,
  // Créditos de legendagem (corpus de treino)
  /legendas?\s+(da|pela|por)\s+comunidade\s+amara/i,
  /^as\s+legendas\s+em\s+portugu[êe]s/i,
  /tradu(ç|c)[ãa]o\s+e\s+legenda(gem|s)\s+(de|por)/i,
  /sub(títul|titul)os?\s+(por|de|pela)\s+\w+/i,
  // Marcadores não-fala (mesmo com --suppress-nst alguns sobrevivem)
  /^[♪♫]+/,
  /^\[\s*(m[úu]sica|aplausos?|risos?|silêncio|barulho|tosse|music|applause|laughter|silence)\s*\]/i,
  /^\(\s*(m[úu]sica|aplausos?|risos?|silêncio|barulho|music|applause|laughter|silence)\s*\)/i,
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
 * pelo menos minRepeats vezes. Quando encontra, emite UM ciclo e pula o
 * resto. Cobre tanto repetição direta (A A A → A) quanto ciclos
 * (A B C A B C → A B C).
 */
export function collapseHallucinationCycles(
  segments: TranscriptSegment[],
  opts: CollapseCyclesOptions = {}
): TranscriptSegment[] {
  const maxCycleLen = opts.maxCycleLen ?? DEFAULT_MAX_CYCLE_LEN;
  const minRepeats = opts.minRepeats ?? DEFAULT_MIN_REPEATS;

  if (segments.length < 2) return segments;

  const norms = segments.map((s) => normalizeText(s.text));
  const out: TranscriptSegment[] = [];

  let i = 0;
  while (i < segments.length) {
    let bestCycleLen = 0;
    let bestEnd = i;

    for (let k = 1; k <= maxCycleLen; k++) {
      if (i + k * minRepeats > segments.length) continue;
      const isEmptyPattern = norms.slice(i, i + k).every((t) => t.length === 0);
      if (isEmptyPattern) continue;

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
  /** Quantos segmentos longos anteriores considerar para detectar similaridade. */
  windowSize?: number;
  /** Threshold de Jaccard de palavras (0..1) para considerar near-duplicate. */
  threshold?: number;
  /** Tamanho mínimo (em palavras) para o segmento ser elegível à comparação.
   * Segmentos curtos (Sim/Não/etc.) são sempre preservados. */
  minWords?: number;
}

/**
 * Remove resíduos de hallucination loop que sobrevivem ao colapso de ciclos
 * porque a quebra de cues do whisper.cpp distribui o mesmo texto entre
 * segmentos com fingerprints diferentes (ex.: "Ele falou para X" / "Ele
 * falou para X para Y" / "Ele falou para X para Y para Z" — todos prefixos
 * uns dos outros).
 *
 * Para cada segmento longo (>= minWords palavras), compara via Jaccard de
 * palavras com os últimos `windowSize` segmentos longos já emitidos.
 * Se a similaridade ultrapassar `threshold`, descarta. Segmentos curtos
 * (Sim/Não/respostas monossilábicas) são sempre mantidos para não perder
 * conteúdo legítimo de respostas repetidas a perguntas distintas.
 */
export function collapseNearDuplicateLongSegments(
  segments: TranscriptSegment[],
  opts: CollapseNearDuplicatesOptions = {}
): TranscriptSegment[] {
  const windowSize = opts.windowSize ?? 8;
  const threshold = opts.threshold ?? 0.7;
  const minWords = opts.minWords ?? 5;

  if (segments.length < 2) return segments;

  const tokens = segments.map((s) =>
    normalizeText(s.text)
      .split(" ")
      .filter((w) => w.length > 0)
  );
  const out: TranscriptSegment[] = [];
  const outLongTokens: string[][] = [];

  for (let i = 0; i < segments.length; i++) {
    const curTokens = tokens[i];
    if (curTokens.length < minWords) {
      out.push(segments[i]);
      continue;
    }

    let isNearDup = false;
    const start = Math.max(0, outLongTokens.length - windowSize);
    for (let j = outLongTokens.length - 1; j >= start; j--) {
      if (jaccardWords(curTokens, outLongTokens[j]) >= threshold) {
        isNearDup = true;
        break;
      }
    }

    if (!isNearDup) {
      out.push(segments[i]);
      outLongTokens.push(curTokens);
    }
  }

  return out;
}

const DEFAULT_INTRA_NGRAM_MAX_LEN = 8;
const DEFAULT_INTRA_NGRAM_MIN_REPEATS = 3;

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
 * Mantém pontuação adjacente.
 */
export function collapseRepeatedNgramsInText(
  text: string,
  opts: { maxN?: number; minRepeats?: number } = {}
): string {
  const maxN = opts.maxN ?? DEFAULT_INTRA_NGRAM_MAX_LEN;
  const minRepeats = opts.minRepeats ?? DEFAULT_INTRA_NGRAM_MIN_REPEATS;

  if (!text) return text;
  const tokens = text.split(/\s+/);
  if (tokens.length < minRepeats * 1) return text;

  // Tenta n decrescente para preferir colapsar ciclos longos antes de curtos.
  for (let n = Math.min(maxN, Math.floor(tokens.length / minRepeats)); n >= 1; n--) {
    const out: string[] = [];
    let i = 0;
    let collapsed = false;

    while (i < tokens.length) {
      if (i + n * minRepeats > tokens.length) {
        out.push(tokens[i]);
        i += 1;
        continue;
      }
      const ngram = tokens.slice(i, i + n).map((t) => t.toLowerCase());
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
      if (repeats >= minRepeats) {
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
