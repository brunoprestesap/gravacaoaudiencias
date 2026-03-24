export interface ChunkRecord {
  id: string;
  gravacaoId: string;
  chunkIndex: number;
  /**
   * Logical recording segment/session.
   * Incremented when a recording is resumed/restarted after interruption.
   */
  segmentIndex?: number;
  data: Blob;
  timestamp: number;
  status: "pending" | "uploaded" | "consolidated";
}

export interface RecoveryRecord {
  gravacaoId: string;
  metadata: ProcessMetadata;
  modo: "PRESENCIAL" | "HIBRIDO";
  startedAt: number;
  lastChunkAt: number;
  status: "recording" | "interrupted";
}

export interface ProcessMetadata {
  numeroProcesso: string;
  classeProcessual?: string;
  partes?: string;
  vara?: string;
  nomeJuiz?: string;
  tipoAudiencia?: string;
  dataAudiencia?: string;
}

export type RecordingStatus = "idle" | "recording" | "paused" | "stopped";

export type ModoGravacao = "PRESENCIAL" | "HIBRIDO";

export type HybridLayout = "pip" | "side-by-side" | "tabs";

export type MultiCameraLayout = "side-by-side" | "stacked" | "grid" | "main-pip";
