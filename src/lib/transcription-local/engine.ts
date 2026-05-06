export type LocalTranscriptionEngine =
  | "whisper"
  | "wav2vec2"
  | "legal-whisper"
  | "google"
  | "mock";

export function getLocalTranscriptionEngine(): LocalTranscriptionEngine {
  const raw = (process.env.LOCAL_TRANSCRIPTION_ENGINE ?? "whisper").trim().toLowerCase();
  if (raw === "wav2vec2" || raw === "wav2vec") {
    return "wav2vec2";
  }
  if (raw === "legal-whisper" || raw === "legalwhisper" || raw === "legal_whisper") {
    return "legal-whisper";
  }
  if (raw === "google" || raw === "gcp" || raw === "chirp" || raw === "chirp_2") {
    return "google";
  }
  if (raw === "mock") {
    return "mock";
  }
  return "whisper";
}
