export const RECORDING = {
  CHUNK_INTERVAL_MS: 5000,
  PREFERRED_CODEC: "video/webm;codecs=vp9,opus",
  FALLBACK_CODEC: "video/webm;codecs=vp8,opus",
  PREVIEW_WIDTH: 1280,
  PREVIEW_HEIGHT: 720,
  RECORD_WIDTH: 1920,
  RECORD_HEIGHT: 1080,
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
