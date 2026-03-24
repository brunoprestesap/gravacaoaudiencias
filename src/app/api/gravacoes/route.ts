import { NextRequest } from "next/server";
import { getSessionOrError } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { apiError, apiOk } from "@/lib/api-response";

// GET /api/gravacoes — Listar gravações
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
  const skip = (page - 1) * limit;

  const user = session!.user;

  // Build where clause based on role
  const where: Record<string, unknown> = {};

  if (user.role === "SERVIDOR") {
    where.userId = user.id;
  } else {
    // JUIZ: all recordings from their vara
    if (user.vara) {
      where.vara = user.vara;
    }
  }

  // Search by processo number
  if (search) {
    where.numeroProcesso = { contains: search, mode: "insensitive" };
  }

  const baseSelect = {
    id: true,
    numeroProcesso: true,
    classeProcessual: true,
    partes: true,
    vara: true,
    nomeJuiz: true,
    tipoAudiencia: true,
    dataAudiencia: true,
    modo: true,
    duracao: true,
    tamanhoArquivo: true,
    status: true,
    transcricaoStatus: true,
    transcricaoTexto: true,
    transcricaoErro: true,
    createdAt: true,
  } as const;

  let gravacoes: Array<Record<string, unknown>> = [];
  const total = await prisma.gravacao.count({ where });

  try {
    gravacoes = await prisma.gravacao.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        ...baseSelect,
        transcricaoSegmentos: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const isUnknownSegmentsField = message.includes("Unknown field `transcricaoSegmentos`");

    if (!isUnknownSegmentsField) {
      throw error;
    }

    // Fallback temporário para evitar quebra enquanto o servidor dev está com Prisma Client antigo em memória.
    const legacyRows = await prisma.gravacao.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: baseSelect,
    });
    gravacoes = legacyRows.map((row) => ({
      ...row,
      transcricaoSegmentos: null,
    }));
  }

  return apiOk({ gravacoes, total, page, limit });
}

// POST /api/gravacoes — Criar registro de gravação
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  const user = session!.user;

  if (user.role !== "SERVIDOR") {
    return apiError("Apenas servidores podem criar gravações.", 403);
  }

  try {
    const body = await req.json();
    const { id, metadata, modo } = body;

    if (!metadata?.numeroProcesso || !modo) {
      return apiError("Número do processo e modo são obrigatórios.", 400);
    }

    const gravacao = await prisma.gravacao.create({
      data: {
        ...(id ? { id } : {}),
        numeroProcesso: metadata.numeroProcesso,
        classeProcessual: metadata.classeProcessual || null,
        partes: metadata.partes || null,
        vara: metadata.vara || user.vara || null,
        nomeJuiz: metadata.nomeJuiz || null,
        tipoAudiencia: metadata.tipoAudiencia || null,
        dataAudiencia: metadata.dataAudiencia
          ? new Date(metadata.dataAudiencia)
          : null,
        modo,
        status: "EM_ANDAMENTO",
        userId: user.id,
      },
    });

    return apiOk({ gravacao });
  } catch (err) {
    console.error("Erro ao criar gravação:", err);
    return apiError("Erro ao criar registro de gravação.", 500);
  }
}
