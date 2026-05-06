import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { apiError, apiOk } from "@/lib/api-response";
import { getSessionOrError } from "@/lib/api-auth";
import { assertGravacaoAccess } from "@/lib/gravacao-access";
import { prisma } from "@/lib/db";
import { parseStoredSegments } from "@/lib/transcription-diarization";
import { gerarTermoAudiencia } from "@/lib/termo-audiencia/service";
import {
  MaritacaApiError,
  MaritacaConfigError,
} from "@/lib/termo-audiencia/maritaca";
import type { ProcessMetadata } from "@/types/recording";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const TERMO_SELECT = {
  id: true,
  userId: true,
  vara: true,
  termoStatus: true,
  termoTexto: true,
  termoEstruturado: true,
  termoTipo: true,
  termoErro: true,
  termoAtualizadoEm: true,
} as const;

const POST_SELECT = {
  id: true,
  userId: true,
  vara: true,
  transcricaoStatus: true,
  transcricaoTexto: true,
  transcricaoSegmentos: true,
  termoStatus: true,
  numeroProcesso: true,
  classeProcessual: true,
  partes: true,
  nomeJuiz: true,
  tipoAudiencia: true,
  dataAudiencia: true,
} as const;

type GravacaoParaGeracao = Prisma.GravacaoGetPayload<{ select: typeof POST_SELECT }>;

function toProcessMetadata(gravacao: GravacaoParaGeracao): ProcessMetadata {
  return {
    numeroProcesso: gravacao.numeroProcesso,
    classeProcessual: gravacao.classeProcessual ?? undefined,
    partes: gravacao.partes ?? undefined,
    vara: gravacao.vara ?? undefined,
    nomeJuiz: gravacao.nomeJuiz ?? undefined,
    tipoAudiencia: gravacao.tipoAudiencia ?? undefined,
    dataAudiencia: gravacao.dataAudiencia
      ? gravacao.dataAudiencia.toISOString().slice(0, 10)
      : undefined,
  };
}

function logBackgroundError(gravacaoId: string, err: unknown): string {
  console.error(`[termo-audiencia] gravacao=${gravacaoId} falhou:`, err);
  if (err instanceof MaritacaApiError || err instanceof MaritacaConfigError) {
    return err.message;
  }
  return "Falha inesperada ao gerar o termo.";
}

async function persistTermoErro(gravacaoId: string, mensagem: string): Promise<void> {
  try {
    await prisma.gravacao.update({
      where: { id: gravacaoId },
      data: {
        termoStatus: "ERRO",
        termoErro: mensagem,
        termoAtualizadoEm: new Date(),
      },
    });
  } catch (dbErr) {
    console.error(
      `[termo-audiencia] falha ao gravar status ERRO para ${gravacaoId}:`,
      dbErr
    );
  }
}

function executarGeracaoEmBackground(
  gravacaoId: string,
  metadata: ProcessMetadata,
  segmentos: ReturnType<typeof parseStoredSegments>,
  fallbackTexto: string
): void {
  void (async () => {
    try {
      const termo = await gerarTermoAudiencia({ metadata, segmentos, fallbackTexto });
      await prisma.gravacao.update({
        where: { id: gravacaoId },
        data: {
          termoStatus: "CONCLUIDA",
          termoTexto: termo.markdown,
          termoEstruturado: termo as unknown as Prisma.InputJsonValue,
          termoTipo: termo.tipoSentenca,
          termoErro: null,
          termoAtualizadoEm: new Date(),
        },
      });
    } catch (err) {
      const mensagem = logBackgroundError(gravacaoId, err);
      await persistTermoErro(gravacaoId, mensagem);
    }
  })();
}

// GET /api/gravacoes/:id/termo — Status e conteúdo do termo
export async function GET(_req: NextRequest, context: RouteContext) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  const { id } = await context.params;
  const user = session!.user;

  const gravacao = await prisma.gravacao.findUnique({
    where: { id },
    select: TERMO_SELECT,
  });

  const denied = assertGravacaoAccess(
    user,
    gravacao ? { userId: gravacao.userId, vara: gravacao.vara } : null,
    "read"
  );
  if (denied) return denied;

  if (!gravacao) {
    return apiError("Gravação não encontrada.", 404);
  }

  return apiOk({
    termo: {
      status: gravacao.termoStatus,
      texto: gravacao.termoTexto,
      estruturado: gravacao.termoEstruturado,
      tipo: gravacao.termoTipo,
      erro: gravacao.termoErro,
      atualizadoEm: gravacao.termoAtualizadoEm,
    },
  });
}

// POST /api/gravacoes/:id/termo — Disparar geração do termo via Maritaca
export async function POST(_req: NextRequest, context: RouteContext) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  const { id } = await context.params;
  const user = session!.user;

  const gravacao = await prisma.gravacao.findUnique({
    where: { id },
    select: POST_SELECT,
  });

  const denied = assertGravacaoAccess(
    user,
    gravacao ? { userId: gravacao.userId, vara: gravacao.vara } : null,
    "write",
    "patch"
  );
  if (denied) return denied;

  if (!gravacao) {
    return apiError("Gravação não encontrada.", 404);
  }

  if (gravacao.transcricaoStatus !== "CONCLUIDA") {
    return apiError(
      "A transcrição precisa estar concluída para gerar o termo.",
      400
    );
  }

  if (!gravacao.transcricaoTexto || gravacao.transcricaoTexto.trim().length === 0) {
    return apiError("Transcrição vazia: nada para o termo de audiência.", 400);
  }

  if (gravacao.termoStatus === "PROCESSANDO") {
    return apiOk({
      termo: { status: "PROCESSANDO" },
      message: "O termo desta gravação já está em geração.",
    });
  }

  if (!process.env.MARITACA_API_KEY) {
    return apiError("MARITACA_API_KEY não configurada no servidor.", 500);
  }

  await prisma.gravacao.update({
    where: { id: gravacao.id },
    data: {
      termoStatus: "PROCESSANDO",
      termoErro: null,
      termoAtualizadoEm: new Date(),
    },
  });

  executarGeracaoEmBackground(
    gravacao.id,
    toProcessMetadata(gravacao),
    parseStoredSegments(gravacao.transcricaoSegmentos),
    gravacao.transcricaoTexto
  );

  return apiOk({
    termo: { status: "PROCESSANDO" },
    message: "Geração do termo iniciada em segundo plano.",
  });
}

// PATCH /api/gravacoes/:id/termo — Salvar edição manual do markdown
export async function PATCH(req: NextRequest, context: RouteContext) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  const { id } = await context.params;
  const user = session!.user;

  const gravacao = await prisma.gravacao.findUnique({
    where: { id },
    select: { id: true, userId: true, vara: true },
  });

  const denied = assertGravacaoAccess(
    user,
    gravacao ? { userId: gravacao.userId, vara: gravacao.vara } : null,
    "write",
    "patch"
  );
  if (denied) return denied;

  if (!gravacao) {
    return apiError("Gravação não encontrada.", 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("Payload inválido.", 400);
  }

  const texto = (body as { texto?: unknown })?.texto;
  if (typeof texto !== "string" || texto.trim().length === 0) {
    return apiError("Campo 'texto' é obrigatório.", 400);
  }

  const updated = await prisma.gravacao.update({
    where: { id: gravacao.id },
    data: {
      termoTexto: texto,
      termoStatus: "CONCLUIDA",
      termoErro: null,
      termoAtualizadoEm: new Date(),
    },
    select: {
      termoStatus: true,
      termoTexto: true,
      termoTipo: true,
      termoAtualizadoEm: true,
    },
  });

  return apiOk({
    termo: {
      status: updated.termoStatus,
      texto: updated.termoTexto,
      tipo: updated.termoTipo,
      atualizadoEm: updated.termoAtualizadoEm,
    },
  });
}
