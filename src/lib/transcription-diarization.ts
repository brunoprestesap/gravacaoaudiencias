import type { ProcessMetadata } from "@/types/recording";

export type SpeakerRole = "JUIZ" | "PARTE" | "PROCURADOR" | "DESCONHECIDO";

export interface VoiceFeatures {
  pitchMeanHz?: number;
  pitchStdHz?: number;
  energyMeanDb?: number;
  pauseRatio?: number;
  speechRateApprox?: number;
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

const normalizedContainsAny = (text: string, terms: string[]) => (
  terms.some((term) => text.includes(term))
);

function inferRoleFromCourtDialogue(text: string): RoleInference | null {
  const normalized = normalizeText(text);

  // Forte indicativo de fala do juiz (condução da audiência).
  if (normalizedContainsAny(normalized, [
    "com a palavra",
    "passo a palavra",
    "pode falar",
    "indefiro",
    "deferido",
    "prossiga",
    "ordem de oitiva",
    "testemunha",
    "advertido",
  ])) {
    return { role: "JUIZ", confidence: 0.81 };
  }

  // Forte indicativo de membro do MP/procurador/advocacia.
  if (normalizedContainsAny(normalized, [
    "ministerio publico",
    "promotoria",
    "requer o ministerio publico",
    "requer a defesa",
    "pela acusacao",
    "pela defesa",
    "diligencia",
    "manifestacao",
  ])) {
    return { role: "PROCURADOR", confidence: 0.79 };
  }

  // Fala típica de parte/testemunha em resposta.
  if (normalizedContainsAny(normalized, [
    "nao me recordo",
    "eu confirmo",
    "eu nao confirmo",
    "sim senhor",
    "sim excelencia",
    "nao excelencia",
    "eu estava",
    "eu vi",
    "eu ouvi",
  ])) {
    return { role: "PARTE", confidence: 0.76 };
  }

  return null;
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

  const judgeName = normalizeText(metadata?.nomeJuiz ?? "");
  if (judgeName && normalized.includes(judgeName)) {
    return { role: "JUIZ", confidence: 0.92 };
  }

  const partyTokens = toPartyTokens(metadata?.partes).map((token) => normalizeText(token));
  if (partyTokens.some((token) => token.length >= 3 && normalized.includes(token))) {
    return { role: "PARTE", confidence: 0.85 };
  }

  for (const [role, patterns] of Object.entries(rolePatterns) as Array<
    [Exclude<SpeakerRole, "DESCONHECIDO">, RegExp[]]
  >) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      return { role, confidence: 0.78 };
    }
  }

  return { role: "DESCONHECIDO", confidence: 0.45 };
}

const roleSpeakerCounters: Record<SpeakerRole, number> = {
  JUIZ: 0,
  PARTE: 0,
  PROCURADOR: 0,
  DESCONHECIDO: 0,
};

function ensureSpeakerId(role: SpeakerRole, preferred?: string) {
  if (preferred?.trim()) return preferred;
  roleSpeakerCounters[role] += 1;
  return `spk_${role.toLowerCase()}_${roleSpeakerCounters[role]}`;
}

function normalizeVoiceFeatures(input?: VoiceFeatures): VoiceFeatures | undefined {
  if (!input) return undefined;
  const output: VoiceFeatures = {};
  if (typeof input.pitchMeanHz === "number") output.pitchMeanHz = input.pitchMeanHz;
  if (typeof input.pitchStdHz === "number") output.pitchStdHz = input.pitchStdHz;
  if (typeof input.energyMeanDb === "number") output.energyMeanDb = input.energyMeanDb;
  if (typeof input.pauseRatio === "number") output.pauseRatio = Math.min(1, Math.max(0, input.pauseRatio));
  if (typeof input.speechRateApprox === "number") output.speechRateApprox = input.speechRateApprox;
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

  // Heurística leve baseada em prosódia; o texto continua tendo maior peso.
  if (typeof speechRate === "number" && typeof pause === "number") {
    if (speechRate >= 125 && pause < 0.32) {
      return { role: "PROCURADOR", confidence: 0.62 };
    }
    if (speechRate <= 92 && pause >= 0.38) {
      return { role: "JUIZ", confidence: 0.64 };
    }
  }

  if (typeof pitch === "number" && typeof energy === "number") {
    if (pitch < 150 && energy > -24) {
      return { role: "JUIZ", confidence: 0.56 };
    }
    if (pitch > 205 && energy < -20) {
      return { role: "PARTE", confidence: 0.55 };
    }
  }

  return null;
}

function combineRoleInference(
  textInference: RoleInference,
  voiceInference: RoleInference | null
): RoleInference {
  if (!voiceInference) return textInference;

  if (textInference.role === voiceInference.role) {
    return {
      role: textInference.role,
      confidence: Math.min(0.99, textInference.confidence + voiceInference.confidence * 0.2),
    };
  }

  const textWeight = 0.7;
  const voiceWeight = 0.3;
  const weightedText = textInference.confidence * textWeight;
  const weightedVoice = voiceInference.confidence * voiceWeight;

  if (weightedVoice > weightedText + 0.1) {
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

function voiceDistance(a?: VoiceFeatures, b?: VoiceFeatures) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const pitchDelta = Math.abs((a.pitchMeanHz ?? 0) - (b.pitchMeanHz ?? 0)) / 220;
  const energyDelta = Math.abs((a.energyMeanDb ?? -25) - (b.energyMeanDb ?? -25)) / 18;
  const pauseDelta = Math.abs((a.pauseRatio ?? 0.3) - (b.pauseRatio ?? 0.3));
  const rateDelta = Math.abs((a.speechRateApprox ?? 110) - (b.speechRateApprox ?? 110)) / 90;
  return pitchDelta + energyDelta + pauseDelta + rateDelta;
}

function refineUnknownByContext(
  current: TranscriptSegment,
  previous: TranscriptSegment | null
): RoleInference | null {
  if (!previous || !previous.role || previous.role === "DESCONHECIDO") return null;
  const distance = voiceDistance(current.voiceFeatures, previous.voiceFeatures);
  const closeByVoice = Number.isFinite(distance) && distance < 0.62;
  const closeInTime = Math.abs(current.offsetMs - previous.offsetMs) <= 12000;
  if (closeByVoice && closeInTime) {
    return { role: previous.role, confidence: Math.max(0.56, (previous.confidence ?? 0.56) * 0.85) };
  }
  return null;
}

export function diarizeSegmentsByRole(
  segments: TranscriptSegment[],
  metadata?: ProcessMetadata
): TranscriptSegment[] {
  let previous: TranscriptSegment | null = null;
  return segments.map((segment) => {
    const textInference = inferSpeakerRoleFromText(segment.text, metadata);
    const dialogueInference = inferRoleFromCourtDialogue(segment.text);
    const voiceInference = inferRoleFromVoiceFeatures(segment.voiceFeatures);
    const baseInference = dialogueInference && dialogueInference.confidence > textInference.confidence
      ? dialogueInference
      : textInference;
    let mergedInference = combineRoleInference(baseInference, voiceInference);
    const contextualFallback = refineUnknownByContext(segment, previous);
    if (mergedInference.role === "DESCONHECIDO" && contextualFallback) {
      mergedInference = contextualFallback;
    }
    const resolved: TranscriptSegment = {
      ...segment,
      role: segment.role ?? mergedInference.role,
      confidence: segment.confidence ?? mergedInference.confidence,
      speakerId: ensureSpeakerId(segment.role ?? mergedInference.role, segment.speakerId),
      voiceFeatures: normalizeVoiceFeatures(segment.voiceFeatures),
    };
    previous = resolved;
    return resolved;
  });
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
