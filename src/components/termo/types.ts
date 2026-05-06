export type TermoStatus = "PENDENTE" | "PROCESSANDO" | "CONCLUIDA" | "ERRO";

export interface TermoSnapshot {
  status: TermoStatus;
  texto: string | null;
  tipo: string | null;
  erro: string | null;
}

export const TIPO_SENTENCA_LABELS: Record<string, string> = {
  extincao_sem_merito: "Extinção sem mérito",
  procedencia: "Procedência",
  improcedencia: "Improcedência",
  acordo: "Acordo",
  outra: "Outra",
};
