export type LocalTranscriptionEngine = "whisper" | "wav2vec2";

export function getLocalTranscriptionEngine(): LocalTranscriptionEngine {
  const raw = (process.env.LOCAL_TRANSCRIPTION_ENGINE ?? "whisper").trim().toLowerCase();
  if (raw === "wav2vec2" || raw === "wav2vec") {
    return "wav2vec2";
  }
  return "whisper";
}
