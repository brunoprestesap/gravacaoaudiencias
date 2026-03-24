export const RECORDING = {
  CHUNK_INTERVAL_MS: 5000,
  PREFERRED_CODEC: "video/webm;codecs=vp9,opus",
  FALLBACK_CODEC: "video/webm;codecs=vp8,opus",
  PREVIEW_WIDTH: 1280,
  PREVIEW_HEIGHT: 720,
  RECORD_WIDTH: 1280,
  RECORD_HEIGHT: 720,
  RECORD_FPS: 24,
  VIDEO_BITS_PER_SECOND: 1800000,
  AUDIO_BITS_PER_SECOND: 96000,
  PJE_MAX_OUTPUT_SIZE_MB: 300,
} as const;

export const TOAST_DURATIONS = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 0, // persistente
} as const;

export const INDEXEDDB = {
  DB_NAME: "audiencia-trf1",
  DB_VERSION: 1,
  CHUNKS_STORE: "chunks",
  RECOVERY_STORE: "recovery",
} as const;

export const ROLES = {
  SERVIDOR: "SERVIDOR",
  JUIZ: "JUIZ",
} as const;

export const MODO_GRAVACAO = {
  PRESENCIAL: "PRESENCIAL",
  HIBRIDO: "HIBRIDO",
} as const;

export const STATUS_GRAVACAO = {
  EM_ANDAMENTO: "EM_ANDAMENTO",
  PAUSADA: "PAUSADA",
  FINALIZADA: "FINALIZADA",
  INTERROMPIDA: "INTERROMPIDA",
} as const;

export const MULTI_CAMERA_CANVAS = {
  CROSSFADE_DURATION_MS: 300,
  PIP_WIDTH: 280,
  PIP_HEIGHT: 158,
  PIP_MARGIN: 12,
  BORDER_WIDTH: 2,
  DIVIDER_WIDTH: 3,
  LABEL_HEIGHT: 22,
} as const;

export const HYBRID_CANVAS = {
  CROSSFADE_DURATION_MS: 300,
  PIP_WIDTH: 320,
  PIP_HEIGHT: 180,
  PIP_MARGIN: 16,
  DIVIDER_WIDTH: 4,
} as const;

export const AUDIO_ANALYSER = {
  FFT_SIZE: 2048,
  SMOOTHING: 0.75,
  VOICE_THRESHOLD_RMS: 0.012,
  INTERVAL_MS: 350,
} as const;

export const AUDIO_LEVEL = {
  FFT_SIZE: 512,
  SMOOTHING: 0.7,
  RMS_SCALE: 0.25,
  BAR_COUNT: 5,
  BAR_MIN_HEIGHT: 0.12,
  BAR_SENSITIVITY_BASE: 0.6,
  BAR_SENSITIVITY_STEP: 0.1,
} as const;
