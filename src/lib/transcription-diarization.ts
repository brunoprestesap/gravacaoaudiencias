import type { ProcessMetadata } from "@/types/recording";

export type SpeakerRole = "JUIZ" | "PARTE" | "PROCURADOR" | "DESCONHECIDO";

export interface VoiceFeatures {
  pitchMeanHz?: number;
  pitchStdHz?: number;
  energyMeanDb?: number;
  pauseRatio?: number;
  speechRateApprox?: number;
  /** Taxa média de cruzamentos por zero (timbre / “brilho” espectral, 0–1 típico). */
  zeroCrossingRateMean?: number;
  /** Fator de crista médio (picos vs RMS; voz expressiva tende a subir). */
  crestFactorMean?: number;
  /** Entropia do histograma de amplitude (0–1) no trecho. */
  entropyMean?: number;
  /** Faixa dinâmica em dB (Overall do astats). */
  dynamicRangeDb?: number;
  /** Desvio-padrão do nível RMS entre sub-janelas (prosódia / emoção). */
  energyStdDb?: number;
  /** Variação média de RMS entre janelas consecutivas (fluxo espectral simplificado). */
  spectralFluxApprox?: number;
  /**
   * Diferença de pitch estimado (última fração vs primeira fração do segmento).
   * Valores positivos costumam indicar subida de entonação no final (ex.: pergunta coloquial "né?").
   */
  pitchEndLiftHz?: number;
}

export interface TranscriptSegment {
  id: string;
  text: string;
  offsetMs: number;
  createdAt: string;
  speakerId?: string;
  role?: SpeakerRole;
  confidence?: number;
  startMs?: number;
  endMs?: number;
  voiceFeatures?: VoiceFeatures;
}

interface RoleInference {
  role: SpeakerRole;
  confidence: number;
}

const randomId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const normalizeText = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const rolePatterns: Record<Exclude<SpeakerRole, "DESCONHECIDO">, RegExp[]> = {
  JUIZ: [
    /\b(juiz|juiza|excelencia|magistrad[oa])\b/i,
    /\b(esta aberta a audiencia|declaro aberta a audiencia)\b/i,
  ],
  PARTE: [
    /\b(parte autora|parte re|requerente|requerido|autor|reu|reu)\b/i,
    /\b(boa tarde excelencia|sim excelencia)\b/i,
  ],
  PROCURADOR: [
    /\b(procurador|promotor|ministerio publico|advogad[oa])\b/i,
    /\b(boa tarde a todos|manifesto pelo ministerio publico)\b/i,
  ],
};

const toPartyTokens = (partes?: string) => (
  (partes ?? "")
    .split(/[,;]+|\s+-\s+|\s+vs\.?\s+|\s+e\s+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3)
);

const judgeCommandPatterns: RegExp[] = [
  /\bcom a palavra\b/,
  /\bpasso a palavra\b/,
  /\bpode falar\b/,
  /\bindefiro\b/,
  /\bdeferido\b/,
  /\bprossiga\b/,
  /\bordem de oitiva\b/,
  /\badvertido\b/,
  /\bvou\s+(?:ouvir|inquirir|interrogar)\b/,
  /\b(?:eu\s+)?poderia ouvir\b/,
  /\bvou ter que ouvir\b/,
  /\bdeclaro\s+(?:aberta|encerrada)\b/,
  /\bfica\s+(?:intimado|advertido|ciente)\b/,
  /\bpasse-se\s+a\s+(?:oitiva|inquiricao)\b/,
  /\bregistre-se\b/,
  /\beu\s+gostaria de saber\b/,
  /\beu\s+vi aqui que\b/,
  /\bconta aqui pra mim\b/,
  /\ba senhora\s+(?:esta me ouvindo|entrou com|recebeu|alega)\b/,
  /\bo inss\b.*\b(?:contesta|considerou)\b/,
  /\ba questao aqui e saber\b/,
  /\be quanto tempo\b/,
  /\bcomo\s+(?:que\s+)?comecou\b.*\brelacionamento\b/,
  /\bquanto tempo\b.*\b(?:ficou|na cadeira|preso)\b/,
  /\b(?:dona|senhora)\s+[a-z]{3,}\b.*\btudo bem\b/,
  /\bô[, ]?\s*doutor\b/,
  /\bse o senhor quiser\b.*\b(permanecer|ficar|de mascara)\b/,
  /\bo[, ]?\s*doutor\b.*\bfica a vontade\b/,
];

/**
 * Interrogativas formais — padrão de pergunta dirigida pelo juiz.
 * Diferente de `judgeCommandPatterns` (que pega comandos / atos do juiz),
 * estes pegam perguntas que o juiz costuma fazer em instrução.
 *
 * Cobertos:
 *   - tratamento formal "o senhor / a senhora ... ?"
 *   - perguntas iniciadas por interrogativos (como, quanto, qual, onde, ...)
 *   - referência institucional ("o INSS", "Dr. X falou", etc.) seguida de "?"
 */
const judgeQuestionPatterns: RegExp[] = [
  /\b(?:o|a)\s+senhor[a]?\b[^?]*\?/,
  /^(?:como|qual|quais|quem|quanto|quanta|quantos|quantas|onde|quando|porque|por\s+que)\b[^?]*\?/i,
  /\b(?:o\s+senhor|a\s+senhora)\s+(?:tem|está|estava|fez|trabalha|trabalhava|conheceu|recebeu|adoeceu|teve|mora|sofre|precisa|consegue|sabe|lembra)\b/,
  /\b(?:essa|esse|esta|este)\s+(?:senhor[a]?|companheiro[a]?)\b[^?]*\?/,
  /\b(?:dr\.?|doutor[a]?)\s+[a-z]{3,}\b.*\bfalou\b/i,
];

const prosecutorPatterns: RegExp[] = [
  /\bministerio publico\b/,
  /\bpromot[oa]ria\b/,
  /\brequer o ministerio publico\b/,
  /\brequer a defesa\b/,
  /\bpela acusacao\b/,
  /\bpela defesa\b/,
  /\bmanifest(?:o|acao)\s+(?:do|pelo)\s+ministerio\b/,
];

/** Advogado(a) da parte ou defensor — responde à magistrada. */
const defenseCounselPatterns: RegExp[] = [
  /\bnao[, ]+eu prefiro\b/,
  /\beu prefiro ficar assim\b.*\bdoutora\b/,
  /\beu prefiro ficar assim\b.*\bdoutor\b/,
  /\bcom a vossa excelencia\b/,
  /\bmanifesto pela defesa\b/,
];

const partyPatterns: RegExp[] = [
  /\bnao me recordo\b/,
  /\beu confirmo\b/,
  /\beu nao confirmo\b/,
  /\bsim[, ]+senhor\b/,
  /\bsim[, ]+excelencia\b/,
  /\bnao[, ]+excelencia\b/,
  /\beu estava la\b/,
  /\beu presenciei\b/,
  /\beu nao lembro\b/,
  /\beu conheci\b/,
  /\bnamorei com ele\b/,
  /\bnamorei com ela\b/,
  /\bcomecamos a namorar\b/,
  /\bmais de \d+\s+anos\b.*\bvivi com\b/,
  /\bnos dois que planejou\b/,
  /\bconstruimos juntos\b/,
  /\bele foi assassinado\b/,
  /\bminha filha\b.*\bconsidera\b/,
  /\ba casa dele\b/,
  /\bcom ele a senhora ja tinha\b/,
  /\ba sua filha era\b/,
  /\bfoi um namoro no inicio\b/,
  /\bentao[, ]+mais ou menos\b/,
  /\bcom um pedido de\b.*\bpensao\b/,
  /\bfoi isso\b/,
  /\bentao passou anos\b/,
  /\bpra nos ver juntos\b/,
  /\broca grande\b|\bsabara\b/,
  /\bera de nos dois\b/,
];

/** Início da fala com tom institucional (não confundir com relato da parte que termina em "né?"). */
function hasJudicialLeadIn(normalized: string): boolean {
  const head = normalized.slice(0, 72);
  return /\b(a senhora|o senhor|o inss|doutor|doutora|excelencia|declaro|gostaria de saber|com a palavra|vou ter que|eu vi aqui que|conta aqui)\b/.test(head);
}

/**
 * Relato ou confirmação coloquial da parte (inclui tag "né?" / "tá?" no fim), com reforço opcional pela subida de tom no final.
 */
function inferParteColloquialSpeech(
  normalized: string,
  voice?: VoiceFeatures
): RoleInference | null {
  if (hasJudicialLeadIn(normalized)) {
    return null;
  }

  const hasParteDeixis = /\beu\b|\bminha\b|\bmeu\b|\bnos\b|\bnossa\b|\bja sou\b|\bnisso\b/.test(normalized);
  const tagAtEnd = /,\s*ne\s*\?\s*$|,\s*nao\s*\?\s*$|\bta\s*\?\s*$|\bhein\s*\?\s*$|\bne\s*\?\s*$/;

  if (normalized.includes("?") && tagAtEnd.test(normalized) && hasParteDeixis) {
    let confidence = 0.78;
    if (typeof voice?.pitchEndLiftHz === "number" && voice.pitchEndLiftHz > 18) {
      confidence = 0.83;
    }
    return { role: "PARTE", confidence };
  }

  if (/\bnisso\b.*\beu\b/.test(normalized) && normalized.includes("?")) {
    let confidence = 0.77;
    if (typeof voice?.pitchEndLiftHz === "number" && voice.pitchEndLiftHz > 18) {
      confidence = 0.82;
    }
    return { role: "PARTE", confidence };
  }

  return null;
}

function inferRoleFromCourtDialogue(text: string, voice?: VoiceFeatures): RoleInference | null {
  const normalized = normalizeText(text);

  if (judgeCommandPatterns.some((pattern) => pattern.test(normalized))) {
    return { role: "JUIZ", confidence: 0.81 };
  }

  if (judgeQuestionPatterns.some((pattern) => pattern.test(normalized))) {
    return { role: "JUIZ", confidence: 0.78 };
  }

  if (prosecutorPatterns.some((pattern) => pattern.test(normalized))) {
    return { role: "PROCURADOR", confidence: 0.79 };
  }

  if (defenseCounselPatterns.some((pattern) => pattern.test(normalized))) {
    return { role: "PROCURADOR", confidence: 0.8 };
  }

  const colloquialParte = inferParteColloquialSpeech(normalized, voice);
  if (colloquialParte) {
    return colloquialParte;
  }

  if (partyPatterns.some((pattern) => pattern.test(normalized))) {
    return { role: "PARTE", confidence: 0.76 };
  }

  return null;
}

/** Resposta muito curta típica de parte/testemunha após pergunta do juiz. */
function looksLikeBriefPartyReply(text: string): boolean {
  const n = normalizeText(text.trim()).replace(/[.!?…]+$/u, "").trim();
  if (n.length === 0 || n.length > 40) return false;
  return /^(sim|isso|foi|ne|verdade|uhum|uhm|certo|isso mesmo|exato)$/.test(n);
}

const MIN_NAME_LENGTH_FOR_MATCH = 4;

const escapeForRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matchesAsWholeWord(haystack: string, needle: string): boolean {
  if (needle.length < MIN_NAME_LENGTH_FOR_MATCH) return false;
  const pattern = new RegExp(`\\b${escapeForRegex(needle)}\\b`);
  return pattern.test(haystack);
}

/**
 * Quando o engine upstream (Chirp 3) entrega speakerLabels acusticamente
 * confiáveis, um mesmo speaker DEVE ter um único papel ao longo de toda a
 * audiência. A inferência por segmento independente (em diarizeSegmentsByRole)
 * pode "trocar" papel entre segmentos do mesmo speaker dependendo do conteúdo
 * textual, gerando saídas como "JUIZCorreto" (resposta da parte mas com label
 * JUIZ porque a frase é curta e ambígua).
 *
 * Esta função agrupa por speakerId upstream, soma a confiança de inferência
 * por papel ao longo de TODOS os segmentos do mesmo speaker, e estampa o
 * papel dominante em todos os segmentos do grupo. Se < 50% dos segmentos
 * tiverem speakerId (engines locais sem diarização nativa), é no-op.
 */
export function harmonizeRolesByUpstreamSpeaker(
  segments: TranscriptSegment[],
  metadata?: ProcessMetadata
): TranscriptSegment[] {
  const groups = new Map<string, TranscriptSegment[]>();
  for (const s of segments) {
    if (!s.speakerId) continue;
    const arr = groups.get(s.speakerId);
    if (arr) arr.push(s);
    else groups.set(s.speakerId, [s]);
  }

  const withSpeakerCount = [...groups.values()].reduce((a, g) => a + g.length, 0);
  if (withSpeakerCount < segments.length / 2) return segments;

  const dominantRoleByGroup = new Map<string, SpeakerRole>();
  for (const [groupId, group] of groups) {
    const tally: Record<SpeakerRole, number> = {
      JUIZ: 0,
      PARTE: 0,
      PROCURADOR: 0,
      DESCONHECIDO: 0,
    };
    for (const s of group) {
      const fromText = inferSpeakerRoleFromText(s.text, metadata);
      const fromDialogue = inferRoleFromCourtDialogue(s.text, s.voiceFeatures);
      const best =
        fromDialogue && fromDialogue.confidence > fromText.confidence
          ? fromDialogue
          : fromText;
      if (best.role !== "DESCONHECIDO") {
        tally[best.role] += best.confidence;
      }
    }
    let bestRole: SpeakerRole = "DESCONHECIDO";
    let bestScore = 0;
    for (const role of ["JUIZ", "PARTE", "PROCURADOR"] as const) {
      if (tally[role] > bestScore) {
        bestScore = tally[role];
        bestRole = role;
      }
    }
    if (bestScore > 0) dominantRoleByGroup.set(groupId, bestRole);
  }

  return segments.map((s) => {
    if (!s.speakerId) return s;
    const role = dominantRoleByGroup.get(s.speakerId);
    if (!role) return s;
    return { ...s, role };
  });
}

export function inferSpeakerRoleFromText(
  text: string,
  metadata?: ProcessMetadata
): RoleInference {
  const content = text.trim();
  if (!content) {
    return { role: "DESCONHECIDO", confidence: 0 };
  }

  const normalized = normalizeText(content);

  const judgeName = normalizeText(metadata?.nomeJuiz ?? "").trim();
  if (judgeName.length >= MIN_NAME_LENGTH_FOR_MATCH && matchesAsWholeWord(normalized, judgeName)) {
    return { role: "JUIZ", confidence: 0.92 };
  }

  const partyTokens = toPartyTokens(metadata?.partes).map((token) => normalizeText(token));
  if (partyTokens.some((token) => matchesAsWholeWord(normalized, token))) {
    return { role: "PARTE", confidence: 0.85 };
  }

  for (const [role, patterns] of Object.entries(rolePatterns) as Array<
    [Exclude<SpeakerRole, "DESCONHECIDO">, RegExp[]]
  >) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      return { role, confidence: 0.78 };
    }
  }

  return { role: "DESCONHECIDO", confidence: 0.28 };
}

function createSpeakerIdAllocator() {
  const counters: Record<SpeakerRole, number> = {
    JUIZ: 0,
    PARTE: 0,
    PROCURADOR: 0,
    DESCONHECIDO: 0,
  };
  return (role: SpeakerRole, preferred?: string) => {
    if (preferred?.trim()) return preferred;
    counters[role] += 1;
    return `spk_${role.toLowerCase()}_${counters[role]}`;
  };
}

function normalizeVoiceFeatures(input?: VoiceFeatures): VoiceFeatures | undefined {
  if (!input) return undefined;
  const output: VoiceFeatures = {};
  if (typeof input.pitchMeanHz === "number") output.pitchMeanHz = input.pitchMeanHz;
  if (typeof input.pitchStdHz === "number") output.pitchStdHz = input.pitchStdHz;
  if (typeof input.energyMeanDb === "number") output.energyMeanDb = input.energyMeanDb;
  if (typeof input.pauseRatio === "number") output.pauseRatio = Math.min(1, Math.max(0, input.pauseRatio));
  if (typeof input.speechRateApprox === "number") output.speechRateApprox = input.speechRateApprox;
  if (typeof input.zeroCrossingRateMean === "number") {
    output.zeroCrossingRateMean = Math.min(1, Math.max(0, input.zeroCrossingRateMean));
  }
  if (typeof input.crestFactorMean === "number") output.crestFactorMean = input.crestFactorMean;
  if (typeof input.entropyMean === "number") {
    output.entropyMean = Math.min(1, Math.max(0, input.entropyMean));
  }
  if (typeof input.dynamicRangeDb === "number") output.dynamicRangeDb = input.dynamicRangeDb;
  if (typeof input.energyStdDb === "number") output.energyStdDb = input.energyStdDb;
  if (typeof input.spectralFluxApprox === "number") output.spectralFluxApprox = input.spectralFluxApprox;
  if (typeof input.pitchEndLiftHz === "number" && Number.isFinite(input.pitchEndLiftHz)) {
    output.pitchEndLiftHz = Math.max(-120, Math.min(120, input.pitchEndLiftHz));
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function inferRoleFromVoiceFeatures(
  voiceFeatures?: VoiceFeatures
): RoleInference | null {
  if (!voiceFeatures) return null;

  const pitch = voiceFeatures.pitchMeanHz;
  const pause = voiceFeatures.pauseRatio;
  const speechRate = voiceFeatures.speechRateApprox;
  const energy = voiceFeatures.energyMeanDb;
  const entropy = voiceFeatures.entropyMean;
  const crest = voiceFeatures.crestFactorMean;
  const eStd = voiceFeatures.energyStdDb;
  const flux = voiceFeatures.spectralFluxApprox;
  const zcr = voiceFeatures.zeroCrossingRateMean;

  const hasCore = typeof pitch === "number" || typeof energy === "number";
  const hasRich = [entropy, crest, eStd, flux, zcr].some((x) => typeof x === "number");

  if (!hasCore && !hasRich) return null;

  let scoreJuiz = 0;
  let scoreParte = 0;
  let scoreProc = 0;

  if (typeof speechRate === "number" && typeof pause === "number") {
    if (speechRate >= 122 && pause < 0.34) scoreProc += 0.26;
    if (speechRate <= 94 && pause >= 0.36) scoreJuiz += 0.22;
    if (speechRate >= 108 && speechRate < 122 && pause < 0.36) scoreProc += 0.08;
  }

  if (typeof pitch === "number") {
    if (pitch < 152) scoreJuiz += 0.16;
    if (pitch > 198) scoreParte += 0.14;
    if (pitch >= 160 && pitch <= 195) scoreProc += 0.06;
  }

  if (typeof energy === "number") {
    if (energy > -22 && typeof pitch === "number" && pitch < 165) scoreJuiz += 0.1;
    if (energy < -21) scoreParte += 0.08;
    if (energy > -20.5 && typeof speechRate === "number" && speechRate > 112) scoreProc += 0.1;
  }

  if (typeof entropy === "number") {
    if (entropy < 0.44) scoreJuiz += 0.1;
    if (entropy > 0.58) scoreParte += 0.12;
  }

  if (typeof crest === "number") {
    if (crest > 2.6) scoreParte += 0.1;
    if (crest < 2.1) scoreJuiz += 0.06;
  }

  if (typeof eStd === "number") {
    if (eStd > 2.8) scoreParte += 0.14;
    if (eStd < 1.4) scoreJuiz += 0.08;
  }

  if (typeof flux === "number") {
    if (flux > 1.15) scoreParte += 0.12;
    if (flux < 0.55) scoreJuiz += 0.08;
  }

  if (typeof zcr === "number") {
    if (zcr > 0.14) scoreParte += 0.06;
    if (zcr < 0.09) scoreJuiz += 0.05;
  }

  const lift = voiceFeatures.pitchEndLiftHz;
  if (typeof lift === "number") {
    if (lift > 22) scoreParte += 0.1;
    if (lift < -12) scoreJuiz += 0.05;
  }

  const best = Math.max(scoreJuiz, scoreParte, scoreProc);
  if (best < 0.26) return null;

  const role: SpeakerRole = best === scoreJuiz
    ? "JUIZ"
    : best === scoreParte
      ? "PARTE"
      : "PROCURADOR";

  return {
    role,
    confidence: Math.min(0.74, 0.44 + best * 0.85),
  };
}

function combineRoleInference(
  textInference: RoleInference,
  voiceInference: RoleInference | null
): RoleInference {
  if (textInference.role === "DESCONHECIDO" && voiceInference && voiceInference.confidence >= 0.53) {
    return {
      role: voiceInference.role,
      confidence: Math.min(0.82, 0.52 + voiceInference.confidence * 0.38),
    };
  }

  if (!voiceInference) return textInference;

  if (textInference.role === voiceInference.role) {
    return {
      role: textInference.role,
      confidence: Math.min(0.99, textInference.confidence + voiceInference.confidence * 0.2),
    };
  }

  const textWeight = 0.74;
  const voiceWeight = 0.26;
  const weightedText = textInference.confidence * textWeight;
  const weightedVoice = voiceInference.confidence * voiceWeight;

  if (weightedVoice > weightedText + 0.14) {
    return {
      role: voiceInference.role,
      confidence: Math.min(0.8, 0.45 + weightedVoice),
    };
  }

  return {
    role: textInference.role,
    confidence: Math.max(0.35, weightedText + 0.1),
  };
}

type VoiceMetric = readonly [key: keyof VoiceFeatures, scale: number, weight: number];

const VOICE_DISTANCE_METRICS: VoiceMetric[] = [
  ["pitchMeanHz", 220, 1.15],
  ["energyMeanDb", 18, 1.05],
  ["pauseRatio", 1, 0.95],
  ["speechRateApprox", 95, 0.85],
  ["zeroCrossingRateMean", 0.22, 0.75],
  ["crestFactorMean", 2.2, 0.65],
  ["entropyMean", 0.45, 0.7],
  ["dynamicRangeDb", 120, 0.35],
  ["energyStdDb", 8, 0.8],
  ["spectralFluxApprox", 2.5, 0.85],
  ["pitchEndLiftHz", 55, 0.55],
];

function voiceDistance(a?: VoiceFeatures, b?: VoiceFeatures) {
  if (!a || !b) return Number.POSITIVE_INFINITY;

  let weighted = 0;
  let totalWeight = 0;

  for (const [key, scale, weight] of VOICE_DISTANCE_METRICS) {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "number" && typeof bv === "number" && Number.isFinite(av) && Number.isFinite(bv)) {
      weighted += weight * (Math.abs(av - bv) / scale);
      totalWeight += weight;
    }
  }

  if (totalWeight < 0.4) {
    const pitchDelta = Math.abs((a.pitchMeanHz ?? 0) - (b.pitchMeanHz ?? 0)) / 220;
    const energyDelta = Math.abs((a.energyMeanDb ?? -25) - (b.energyMeanDb ?? -25)) / 18;
    const pauseDelta = Math.abs((a.pauseRatio ?? 0.3) - (b.pauseRatio ?? 0.3));
    const rateDelta = Math.abs((a.speechRateApprox ?? 110) - (b.speechRateApprox ?? 110)) / 90;
    return pitchDelta + energyDelta + pauseDelta + rateDelta;
  }

  return weighted / totalWeight;
}

const CONTEXT_WINDOW_SIZE = 8;
/** Abaixo disso = mesma voz (continuidade para DESCONHECIDO / coerência). */
const SAME_SPEAKER_VOICE_THRESHOLD = 0.44;
/** Limite para casar com histórico em findBestVoiceMatch. */
const VOICE_SIMILARITY_THRESHOLD = 0.53;
const TIME_PROXIMITY_MS = 30_000;
/** Acima disso = provável troca física de locutor (evita fundir dois falantes). */
const SPEAKER_CHANGE_THRESHOLD = 0.82;
/** Voz muito parecida com o turno anterior — histerese contra troca de papel. */
const ACOUSTIC_GLUE_TO_PREVIOUS = 0.37;
const ISLAND_MAX_VOICE_DIST = 0.51;
const COALESCE_VOICE_TO_PREV_ID = 0.47;

interface ResolvedSegmentWithInference extends TranscriptSegment {
  inferenceConfidence: number;
}

/**
 * Pergunta típica de juiz à parte (não basta "?"; evita "né?" coloquial da própria parte).
 */
function looksLikeJudicialQuestionForBriefReply(text: string): boolean {
  const n = normalizeText(text.trim());
  if (!n.includes("?")) return false;

  if (inferParteColloquialSpeech(n, undefined)) {
    return false;
  }

  const institutional = /\ba senhora\b|\bo senhor\b|\bdoutor\b|\bdoutora\b|\bcomo\b|\bqual\b|\bquanto\b|\bpor que\b|\bporque\b.*\?|\bpode\b|\bentende\b|\bo inss\b|\bgostaria de saber\b|\bme diga\b|\bme conta\b|\bfoi em que ano\b|\bquanto tempo\b/;
  if (institutional.test(n)) return true;

  return n.length >= 78;
}

function previousInvitesBriefParteReply(prev: ResolvedSegmentWithInference | null): boolean {
  if (!prev || prev.role !== "JUIZ") return false;
  const t = prev.text.trim();
  if (looksLikeJudicialQuestionForBriefReply(t)) return true;
  return t.length > 22;
}

function effectiveHistoryRole(
  segment: ResolvedSegmentWithInference
): SpeakerRole | null {
  if (segment.role && segment.role !== "DESCONHECIDO") {
    return segment.role;
  }
  const v = inferRoleFromVoiceFeatures(segment.voiceFeatures);
  if (v && v.confidence >= 0.56) {
    return v.role;
  }
  return null;
}

function findBestVoiceMatch(
  current: TranscriptSegment,
  history: ResolvedSegmentWithInference[]
): ResolvedSegmentWithInference | null {
  let bestMatch: ResolvedSegmentWithInference | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = history.length - 1; i >= 0; i--) {
    const candidate = history[i];
    const effectiveRole = effectiveHistoryRole(candidate);
    if (!effectiveRole) continue;

    const timeDelta = Math.abs(
      (current.startMs ?? current.offsetMs) - (candidate.endMs ?? candidate.offsetMs)
    );
    if (timeDelta > TIME_PROXIMITY_MS) continue;

    const distance = voiceDistance(current.voiceFeatures, candidate.voiceFeatures);
    if (Number.isFinite(distance) && distance < bestDistance) {
      bestDistance = distance;
      bestMatch = candidate;
    }
  }

  if (!(bestDistance < VOICE_SIMILARITY_THRESHOLD && bestMatch)) {
    return null;
  }

  const resolvedRole = effectiveHistoryRole(bestMatch) ?? bestMatch.role;
  if (!resolvedRole || resolvedRole === "DESCONHECIDO") {
    return null;
  }

  return { ...bestMatch, role: resolvedRole };
}

function resolveWithVoiceConsistency(
  textBasedInference: RoleInference,
  current: TranscriptSegment,
  history: ResolvedSegmentWithInference[]
): RoleInference {
  if (history.length === 0) return textBasedInference;

  const voiceMatch = findBestVoiceMatch(current, history);
  if (!voiceMatch) return textBasedInference;

  const distance = voiceDistance(current.voiceFeatures, voiceMatch.voiceFeatures);
  const isSameSpeaker = Number.isFinite(distance) && distance < SAME_SPEAKER_VOICE_THRESHOLD;

  if (isSameSpeaker && textBasedInference.role === "DESCONHECIDO") {
    return {
      role: voiceMatch.role!,
      confidence: Math.max(0.60, (voiceMatch.inferenceConfidence) * 0.90),
    };
  }

  if (textBasedInference.role === "DESCONHECIDO" && voiceMatch) {
    return {
      role: voiceMatch.role!,
      confidence: Math.max(0.56, (voiceMatch.inferenceConfidence) * 0.80),
    };
  }

  return textBasedInference;
}

function detectSpeakerChange(
  current: TranscriptSegment,
  previous: TranscriptSegment | null
): boolean {
  if (!previous) return false;
  const distance = voiceDistance(current.voiceFeatures, previous.voiceFeatures);
  return Number.isFinite(distance) && distance > SPEAKER_CHANGE_THRESHOLD;
}

/**
 * Remove um único segmento com papel diferente entre dois iguais quando a voz
 * do meio é acusticamente parecida com os vizinhos (troca espúria).
 */
function stabilizeIslandInterlocutorRoles(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length < 3) return segments;

  const out = segments.map((s) => ({ ...s }));
  for (let i = 1; i < out.length - 1; i += 1) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    const next = out[i + 1]!;
    const pr = prev.role;
    const cr = cur.role;
    const nr = next.role;
    if (!pr || !cr || !nr || pr === "DESCONHECIDO" || nr === "DESCONHECIDO") continue;
    if (pr !== nr || cr === pr) continue;

    const dL = voiceDistance(cur.voiceFeatures, prev.voiceFeatures);
    const dR = voiceDistance(cur.voiceFeatures, next.voiceFeatures);
    if (!Number.isFinite(dL) || !Number.isFinite(dR)) continue;
    if (Math.max(dL, dR) > ISLAND_MAX_VOICE_DIST) continue;

    const middleDialogue = inferRoleFromCourtDialogue(cur.text, cur.voiceFeatures);
    if (
      middleDialogue
      && middleDialogue.confidence >= 0.75
      && middleDialogue.role !== pr
    ) {
      continue;
    }

    out[i] = {
      ...cur,
      role: pr,
      confidence: Math.min(0.78, Math.max(cur.confidence ?? 0.55, (prev.confidence ?? 0.6) * 0.92)),
    };
  }
  return out;
}

/**
 * Mesmo papel em sequência + voz parecida → mesmo speakerId (menos “trocas” visuais).
 */
function finalizeSpeakerIdsByRoleAndVoice(segments: TranscriptSegment[]): TranscriptSegment[] {
  const allocateSpeakerId = createSpeakerIdAllocator();
  const result: TranscriptSegment[] = [];

  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i]!;
    const role = s.role ?? "DESCONHECIDO";
    const prevOut = result[i - 1];

    let speakerId: string;
    if (!prevOut) {
      speakerId = allocateSpeakerId(role);
    } else {
      const prevRole = prevOut.role ?? "DESCONHECIDO";
      const v = voiceDistance(s.voiceFeatures, prevOut.voiceFeatures);
      const sameRole = prevRole === role && role !== "DESCONHECIDO";
      const glued = Number.isFinite(v) && v < COALESCE_VOICE_TO_PREV_ID;
      if (sameRole && glued && prevOut.speakerId) {
        speakerId = prevOut.speakerId;
      } else {
        speakerId = allocateSpeakerId(role);
      }
    }

    result.push({ ...s, speakerId });
  }
  return result;
}

export function diarizeSegmentsByRole(
  segments: TranscriptSegment[],
  metadata?: ProcessMetadata
): TranscriptSegment[] {
  const allocateSpeakerId = createSpeakerIdAllocator();
  const recentHistory: ResolvedSegmentWithInference[] = [];

  const preliminary: TranscriptSegment[] = segments.map((segment) => {
    const textInference = inferSpeakerRoleFromText(segment.text, metadata);
    const dialogueInference = inferRoleFromCourtDialogue(segment.text, segment.voiceFeatures);
    const voiceInference = inferRoleFromVoiceFeatures(segment.voiceFeatures);
    const baseInference = dialogueInference && dialogueInference.confidence > textInference.confidence
      ? dialogueInference
      : textInference;
    const textBasedMerge = combineRoleInference(baseInference, voiceInference);

    let mergedInference = resolveWithVoiceConsistency(textBasedMerge, segment, recentHistory);

    const previous = recentHistory.length > 0 ? recentHistory[recentHistory.length - 1] : null;

    const dialogueLocksDifferentFromPrev = Boolean(
      previous
      && previous.role
      && previous.role !== "DESCONHECIDO"
      && dialogueInference
      && dialogueInference.confidence >= 0.76
      && dialogueInference.role !== previous.role
    );

    const textLocksDifferentFromPrev = Boolean(
      previous
      && previous.role
      && previous.role !== "DESCONHECIDO"
      && textBasedMerge.role !== "DESCONHECIDO"
      && textBasedMerge.confidence >= 0.84
      && textBasedMerge.role !== previous.role
    );

    if (previous && previous.role && previous.role !== "DESCONHECIDO") {
      const dPrev = voiceDistance(segment.voiceFeatures, previous.voiceFeatures);
      const gluedToPrev = Number.isFinite(dPrev) && dPrev < ACOUSTIC_GLUE_TO_PREVIOUS;
      if (
        gluedToPrev
        && !dialogueLocksDifferentFromPrev
        && !textLocksDifferentFromPrev
        && mergedInference.confidence < 0.66
        && mergedInference.role !== previous.role
      ) {
        mergedInference = {
          role: previous.role,
          confidence: Math.min(
            0.8,
            Math.max(mergedInference.confidence, previous.inferenceConfidence * 0.88)
          ),
        };
      }
    }

    if (
      mergedInference.role === "DESCONHECIDO"
      && previous
      && previous.role === "JUIZ"
      && previous.inferenceConfidence >= 0.58
      && previousInvitesBriefParteReply(previous)
      && looksLikeBriefPartyReply(segment.text)
    ) {
      mergedInference = { role: "PARTE", confidence: 0.62 };
    }

    const speakerChanged = detectSpeakerChange(segment, previous);
    const shouldForceNewId = speakerChanged && mergedInference.role === previous?.role;

    const resolved: ResolvedSegmentWithInference = {
      ...segment,
      role: segment.role ?? mergedInference.role,
      confidence: segment.confidence ?? mergedInference.confidence,
      speakerId: shouldForceNewId
        ? allocateSpeakerId(segment.role ?? mergedInference.role)
        : allocateSpeakerId(segment.role ?? mergedInference.role, segment.speakerId),
      voiceFeatures: normalizeVoiceFeatures(segment.voiceFeatures),
      inferenceConfidence: mergedInference.confidence,
    };

    recentHistory.push(resolved);
    if (recentHistory.length > CONTEXT_WINDOW_SIZE) {
      recentHistory.shift();
    }

    const { inferenceConfidence: _, ...output } = resolved;
    return output;
  });

  const stabilized = stabilizeIslandInterlocutorRoles(preliminary);
  return finalizeSpeakerIdsByRoleAndVoice(stabilized);
}

export function buildTranscriptTextFromSegments(segments: TranscriptSegment[]) {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function parseStoredSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  const parsed = value
    .map((item): TranscriptSegment | null => {
      const candidate = item as Partial<TranscriptSegment>;
      if (
        typeof candidate?.text !== "string"
        || typeof candidate?.offsetMs !== "number"
        || typeof candidate?.createdAt !== "string"
      ) {
        return null;
      }
      return {
        id: typeof candidate.id === "string" ? candidate.id : randomId(),
        text: candidate.text,
        offsetMs: candidate.offsetMs,
        createdAt: candidate.createdAt,
        speakerId: typeof candidate.speakerId === "string" ? candidate.speakerId : undefined,
        role: candidate.role,
        confidence: typeof candidate.confidence === "number" ? candidate.confidence : undefined,
        startMs: typeof candidate.startMs === "number" ? candidate.startMs : undefined,
        endMs: typeof candidate.endMs === "number" ? candidate.endMs : undefined,
        voiceFeatures: normalizeVoiceFeatures(candidate.voiceFeatures),
      } as TranscriptSegment;
    })
    .filter((item): item is TranscriptSegment => item !== null);
  return parsed;
}

export function createBatchSegmentsFromText(text: string): TranscriptSegment[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const source = lines.length > 0 ? lines : text.split(/(?<=[.!?])\s+/).map((line) => line.trim()).filter(Boolean);

  return source.map((line, index) => {
    const rolePrefixMatch = line.match(/^(Juiz|Juiza|Parte|Procurador)\s*:\s*(.+)$/i);
    let role: SpeakerRole | undefined;
    let cleaned = line;

    if (rolePrefixMatch) {
      cleaned = rolePrefixMatch[2].trim();
      const prefix = rolePrefixMatch[1].toLowerCase();
      if (prefix.startsWith("juiz")) role = "JUIZ";
      else if (prefix === "parte") role = "PARTE";
      else if (prefix === "procurador") role = "PROCURADOR";
    }

    const startMs = index * 5000;
    const endMs = startMs + 4500;
    return {
      id: randomId(),
      text: cleaned,
      offsetMs: startMs,
      createdAt: new Date().toISOString(),
      startMs,
      endMs,
      role,
      speakerId: role ? `spk_${role.toLowerCase()}_1` : undefined,
    };
  });
}
