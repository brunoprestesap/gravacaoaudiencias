import { NextRequest, NextResponse } from "next/server";
import { getSessionOrError } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

interface RouteContext {
  params: Promise<{ id: string }>;
}

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
    return NextResponse.json(
      { error: "Gravação não encontrada." },
      { status: 404 }
    );
  }

  // Access control
  if (user.role === "SERVIDOR" && gravacao.userId !== user.id) {
    return NextResponse.json(
      { error: "Acesso negado." },
      { status: 403 }
    );
  }

  if (user.role === "JUIZ" && user.vara && gravacao.vara !== user.vara) {
    return NextResponse.json(
      { error: "Acesso negado." },
      { status: 403 }
    );
  }

  return NextResponse.json({ gravacao });
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
    return NextResponse.json(
      { error: "Gravação não encontrada." },
      { status: 404 }
    );
  }

  // Only the creator (SERVIDOR) can update
  if (gravacao.userId !== user.id) {
    return NextResponse.json(
      { error: "Apenas o servidor que criou a gravação pode atualizá-la." },
      { status: 403 }
    );
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

    return NextResponse.json({ gravacao: updated });
  } catch (err) {
    console.error("Erro ao atualizar gravação:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar gravação." },
      { status: 500 }
    );
  }
}
