import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";

/** Usuário da sessão necessário para checagens de acesso a gravações. */
export type GravacaoAccessUser = {
  id: string;
  role: "SERVIDOR" | "JUIZ";
  vara?: string | null;
};

/** Campos mínimos da gravação para autorização. */
export type GravacaoAccessRecord = {
  userId: string;
  vara: string | null;
};

export function canReadGravacao(
  user: GravacaoAccessUser,
  gravacao: GravacaoAccessRecord
): boolean {
  if (user.role === "SERVIDOR" && gravacao.userId !== user.id) {
    return false;
  }

  // Juiz sem vara não tem acesso: a vara é o que delimita o que ele pode ler.
  if (user.role === "JUIZ" && (!user.vara || gravacao.vara !== user.vara)) {
    return false;
  }

  return true;
}

/**
 * Filtro de listagem equivalente a `canReadGravacao`, ou `null` quando o usuário
 * não pode ver nenhuma gravação. Não use `{ vara: null }` para esse caso: casaria
 * com as gravações sem vara.
 */
export function gravacaoListScope(
  user: GravacaoAccessUser
): { userId: string } | { vara: string } | null {
  if (user.role === "SERVIDOR") {
    return { userId: user.id };
  }
  return user.vara ? { vara: user.vara } : null;
}

export function canServidorWriteGravacao(
  user: GravacaoAccessUser,
  gravacao: GravacaoAccessRecord
): boolean {
  return user.role === "SERVIDOR" && gravacao.userId === user.id;
}

export type GravacaoAccessMode = "read" | "write";

export type GravacaoWriteContext = "patch" | "delete" | "upload";

const writeMessages: Record<
  GravacaoWriteContext,
  { notServidor: string; notOwner: string }
> = {
  patch: {
    notServidor: "Acesso negado.",
    notOwner: "Apenas o servidor que criou a gravação pode atualizá-la.",
  },
  delete: {
    notServidor: "Acesso negado.",
    notOwner: "Apenas o servidor que criou a gravação pode excluí-la.",
  },
  upload: {
    notServidor: "Apenas servidores podem enviar gravações.",
    notOwner: "Apenas o servidor que criou a gravação pode enviar o arquivo.",
  },
};

/**
 * Retorna `NextResponse` de erro (404/403) ou `null` se o acesso é permitido.
 */
export function assertGravacaoAccess(
  user: GravacaoAccessUser,
  gravacao: GravacaoAccessRecord | null,
  mode: GravacaoAccessMode,
  writeContext: GravacaoWriteContext = "patch"
): NextResponse | null {
  if (!gravacao) {
    return apiError("Gravação não encontrada.", 404);
  }

  if (mode === "read") {
    if (!canReadGravacao(user, gravacao)) {
      return apiError("Acesso negado.", 403);
    }
    return null;
  }

  const { notServidor, notOwner } = writeMessages[writeContext];
  if (user.role !== "SERVIDOR") {
    return apiError(notServidor, 403);
  }
  if (gravacao.userId !== user.id) {
    return apiError(notOwner, 403);
  }
  return null;
}
