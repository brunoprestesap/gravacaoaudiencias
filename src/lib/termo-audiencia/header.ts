export interface TermoHeader {
  numeroProcesso: string;
  partes?: string | null;
  vara?: string | null;
  classeProcessual?: string | null;
  tipoAudiencia?: string | null;
}

export const HEADER_INSTITUCIONAL: readonly string[] = [
  "PODER JUDICIÁRIO",
  "JUSTIÇA FEDERAL DE 1º GRAU",
];
