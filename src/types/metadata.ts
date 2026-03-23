export interface ProcessMetadata {
  numeroProcesso: string;
  classeProcessual?: string;
  partes?: string;
  vara?: string;
  nomeJuiz?: string;
  tipoAudiencia?: string;
  dataAudiencia?: string;
}

export const PROCESSO_MASK = "NNNNNNN-NN.NNNN.N.NN.NNNN";
export const PROCESSO_REGEX = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
