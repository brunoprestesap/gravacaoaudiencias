import { NextRequest } from "next/server";
import path from "path";
import { unlink } from "fs/promises";
import { getSessionOrError } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { apiError, apiOk } from "@/lib/api-response";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

// GET /api/gravacoes/:id — Detalhes de uma gravação
export async function GET(_req: NextRequest, context: RouteContext) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  const { id } = await context.params;
  const user = session!.user;

  const gravacao = await prisma.gravacao.findUnique({
    where: { id },
  });

  if (!gravacao) {
    return apiError("Gravação não encontrada.", 404);
  }

  // Access control
  if (user.role === "SERVIDOR" && gravacao.userId !== user.id) {
    return apiError("Acesso negado.", 403);
  }

  if (user.role === "JUIZ" && user.vara && gravacao.vara !== user.vara) {
    return apiError("Acesso negado.", 403);
  }

  return apiOk({ gravacao });
}

// PATCH /api/gravacoes/:id — Atualizar gravação
export async function PATCH(req: NextRequest, context: RouteContext) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  const { id } = await context.params;
  const user = session!.user;

  const gravacao = await prisma.gravacao.findUnique({
    where: { id },
  });

  if (!gravacao) {
    return apiError("Gravação não encontrada.", 404);
  }

  // Only the creator (SERVIDOR) can update
  if (gravacao.userId !== user.id) {
    return apiError("Apenas o servidor que criou a gravação pode atualizá-la.", 403);
  }

  try {
    const body = await req.json();
    const allowedFields = ["status", "duracao", "tamanhoArquivo", "caminhoArquivo"];
    const updateData: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const updated = await prisma.gravacao.update({
      where: { id },
      data: updateData,
    });

    return apiOk({ gravacao: updated });
  } catch (err) {
    console.error("Erro ao atualizar gravação:", err);
    return apiError("Erro ao atualizar gravação.", 500);
  }
}

// DELETE /api/gravacoes/:id — Excluir gravação (qualquer status)
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  const { id } = await context.params;
  const user = session!.user;

  const gravacao = await prisma.gravacao.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      caminhoArquivo: true,
    },
  });

  if (!gravacao) {
    return apiError("Gravação não encontrada.", 404);
  }

  if (gravacao.userId !== user.id) {
    return apiError("Apenas o servidor que criou a gravação pode excluí-la.", 403);
  }

  try {
    await prisma.gravacao.delete({ where: { id: gravacao.id } });

    if (gravacao.caminhoArquivo) {
      const absolutePath = path.join(UPLOAD_DIR, gravacao.caminhoArquivo);
      try {
        await unlink(absolutePath);
      } catch {
        // Arquivo pode não existir mais; não bloqueia exclusão do registro
      }
    }

    return apiOk({ success: true });
  } catch (err) {
    console.error("Erro ao excluir gravação:", err);
    return apiError("Erro ao excluir gravação.", 500);
  }
}
