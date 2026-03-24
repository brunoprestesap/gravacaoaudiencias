import type { ProcessMetadata } from "@/types/recording";

interface ContextualCorrectionResult {
  text: string;
  correctionsApplied: number;
}

interface EntityHitMetrics {
  processNumber: boolean;
  judgeName: boolean;
  parties: number;
}

const normalizeSpace = (value: string) => value.replace(/\s+/g, " ").trim();

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractPartyTokens = (partes?: string) => {
  if (!partes) return [];
  return partes
    .split(/[,;]+|\s+-\s+|\s+vs\.?\s+|\s+e\s+/i)
    .map((item) => normalizeSpace(item))
    .filter((item) => item.length >= 3);
};

const processDigits = (value?: string | null) => (value ?? "").replace(/\D/g, "");

const formatProcessNumber = (digits: string) => {
  if (digits.length !== 20) return digits;
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16, 20)}`;
};

export const applyContextualCorrections = (
  text: string,
  metadata: ProcessMetadata
): ContextualCorrectionResult => {
  let correctedText = normalizeSpace(text);
  let correctionsApplied = 0;

  const processId = processDigits(metadata.numeroProcesso);
  if (processId.length === 20) {
    const processPattern = new RegExp(processId.split("").join("\\D*"), "g");
    const formatted = formatProcessNumber(processId);
    const replaced = correctedText.replace(processPattern, formatted);
    if (replaced !== correctedText) {
      correctionsApplied += 1;
      correctedText = replaced;
    }
  }

  const candidates = [metadata.nomeJuiz, metadata.vara, metadata.classeProcessual]
    .map((value) => normalizeSpace(value ?? ""))
    .filter((value) => value.length >= 3);

  for (const candidate of candidates) {
    const candidatePattern = new RegExp(escapeRegExp(candidate), "i");
    if (candidatePattern.test(correctedText)) continue;

    const token = candidate.split(" ").find((piece) => piece.length >= 4);
    if (!token) continue;
    const tokenPattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
    if (tokenPattern.test(correctedText)) {
      correctedText = correctedText.replace(tokenPattern, candidate);
      correctionsApplied += 1;
    }
  }

  return {
    text: normalizeSpace(correctedText),
    correctionsApplied,
  };
};

export const computeContextEntityHits = (
  text: string,
  metadata: ProcessMetadata
): EntityHitMetrics => {
  const normalizedText = normalizeSpace(text).toLowerCase();
  const processId = processDigits(metadata.numeroProcesso);
  const processFormatted = formatProcessNumber(processId);
  const processNumberHit = processId.length === 20
    && (
      normalizedText.includes(processId)
      || normalizedText.includes(processFormatted.toLowerCase())
    );

  const judgeName = normalizeSpace(metadata.nomeJuiz ?? "").toLowerCase();
  const judgeNameHit = judgeName.length >= 3 && normalizedText.includes(judgeName);

  const parties = extractPartyTokens(metadata.partes);
  const partiesHit = parties.reduce((count, party) => (
    normalizedText.includes(party.toLowerCase()) ? count + 1 : count
  ), 0);

  return {
    processNumber: processNumberHit,
    judgeName: judgeNameHit,
    parties: partiesHit,
  };
};
