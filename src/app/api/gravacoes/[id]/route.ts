import { NextRequest } from "next/server";
import path from "path";
import { unlink } from "fs/promises";
import { getSessionOrError } from "@/lib/api-auth";
import { assertGravacaoAccess } from "@/lib/gravacao-access";
import { prisma } from "@/lib/db";
import { apiError, apiOk } from "@/lib/api-response";
import { transcriptionAudioPathFor } from "@/lib/transcription-local/audio";

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

  const readDenied = assertGravacaoAccess(
    user,
    gravacao ? { userId: gravacao.userId, vara: gravacao.vara } : null,
    "read"
  );
  if (readDenied) return readDenied;

  return apiOk({ gravacao: gravacao as NonNullable<typeof gravacao> });
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

  const patchDenied = assertGravacaoAccess(
    user,
    gravacao ? { userId: gravacao.userId, vara: gravacao.vara } : null,
    "write",
    "patch"
  );
  if (patchDenied) return patchDenied;

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
      vara: true,
      caminhoArquivo: true,
    },
  });

  const deleteDenied = assertGravacaoAccess(
    user,
    gravacao ? { userId: gravacao.userId, vara: gravacao.vara } : null,
    "write",
    "delete"
  );
  if (deleteDenied) return deleteDenied;

  if (!gravacao) {
    return apiError("Gravação não encontrada.", 404);
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
      // Limpa também o WAV pré-extraído de transcrição (sibling), se existir.
      try {
        await unlink(transcriptionAudioPathFor(absolutePath));
      } catch {
        // Sibling pode não existir (gravação antiga ou extração que falhou).
      }
    }

    return apiOk({ success: true });
  } catch (err) {
    console.error("Erro ao excluir gravação:", err);
    return apiError("Erro ao excluir gravação.", 500);
  }
}
