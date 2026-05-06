import { prisma } from "@/lib/db";

export const STALE_TRANSCRICAO_THRESHOLD_MS = 30 * 60 * 1000;

export const STALE_TRANSCRICAO_REASON =
  "Transcrição interrompida pelo reinício do servidor. Reinicie a transcrição.";

export async function recoverStuckTranscriptions() {
  const result = await prisma.gravacao.updateMany({
    where: { transcricaoStatus: "PROCESSANDO" },
    data: {
      transcricaoStatus: "ERRO",
      transcricaoErro: STALE_TRANSCRICAO_REASON,
      transcricaoAtualizadoEm: new Date(),
    },
  });

  if (result.count > 0) {
    console.warn(
      `[transcricao] ${result.count} transcrição(ões) em PROCESSANDO foram marcadas como ERRO no boot do servidor.`
    );
  }

  return result.count;
}

export function isStaleProcessando(updatedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!updatedAt) return true;
  return now.getTime() - updatedAt.getTime() >= STALE_TRANSCRICAO_THRESHOLD_MS;
}
