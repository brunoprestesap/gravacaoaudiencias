import { prisma } from "@/lib/db";

/** Maior que o timeout padrão da Maritaca: passado esse tempo, a chamada já desistiu. */
export const STALE_TERMO_THRESHOLD_MS = 10 * 60 * 1000;

export const STALE_TERMO_REASON =
  "A geração do termo foi interrompida antes de terminar. Tente novamente.";

export async function recoverStuckTermos() {
  const result = await prisma.gravacao.updateMany({
    where: { termoStatus: "PROCESSANDO" },
    data: {
      termoStatus: "ERRO",
      termoErro: STALE_TERMO_REASON,
      termoAtualizadoEm: new Date(),
    },
  });

  if (result.count > 0) {
    console.warn(
      `[termo-audiencia] ${result.count} termo(s) em PROCESSANDO foram marcados como ERRO no boot do servidor.`
    );
  }

  return result.count;
}

export function isStaleTermoProcessando(
  updatedAt: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!updatedAt) return true;
  return now.getTime() - updatedAt.getTime() >= STALE_TERMO_THRESHOLD_MS;
}
