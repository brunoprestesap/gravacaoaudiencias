export interface ChunkRecord {
  id: string;
  gravacaoId: string;
  chunkIndex: number;
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
