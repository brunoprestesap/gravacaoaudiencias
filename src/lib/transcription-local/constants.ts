/** Limite de buffer para saída de `child_process.execFile` (whisper, ffmpeg, Python). */
export const WHISPER_MAX_BUFFER = 20 * 1024 * 1024;

export const DEFAULT_HF_MODEL_ID = "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese";

export const DEFAULT_LEGAL_WHISPER_MODEL_ID =
  "rhaymison/transcription-portuguese-legal-whisper-peft";
export const DEFAULT_LEGAL_WHISPER_BASE_MODEL_ID = "openai/whisper-large-v3";

export const DEFAULT_GOOGLE_TRANSCRIPTION_REGION = "us-central1";
export const DEFAULT_GOOGLE_TRANSCRIPTION_MODEL = "chirp_2";
export const DEFAULT_GOOGLE_TRANSCRIPTION_LANGUAGE = "pt-BR";
export const DEFAULT_GOOGLE_DIARIZATION_MIN_SPEAKERS = 2;
export const DEFAULT_GOOGLE_DIARIZATION_MAX_SPEAKERS = 6;
