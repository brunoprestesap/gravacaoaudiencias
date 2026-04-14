import path from "path";
import { NextRequest } from "next/server";
import { apiError, apiOk } from "@/lib/api-response";
import { Prisma } from "@prisma/client";
import { getSessionOrError } from "@/lib/api-auth";
import { assertGravacaoAccess } from "@/lib/gravacao-access";
import { prisma } from "@/lib/db";
import {
  applyContextualCorrections,
  computeContextEntityHits,
} from "@/lib/transcription-context";
import {
  buildTranscriptTextFromSegments,
  diarizeSegmentsByRole,
  parseStoredSegments,
  type TranscriptSegment,
} from "@/lib/transcription-diarization";
import {
  LocalTranscriptionError,
  transcribeLocalRecording,
  validateLocalTranscriptionRuntime,
} from "@/lib/transcription-local";
import type { ProcessMetadata } from "@/types/recording";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface LiveSegmentPayload {
  id?: string;
  text: string;
  offsetMs: number;
  createdAt: string;
  speakerId?: string;
  role?: "JUIZ" | "PARTE" | "PROCURADOR" | "DESCONHECIDO";
  confidence?: number;
  startMs?: number;
  endMs?: number;
  voiceFeatures?: {
    pitchMeanHz?: number;
    pitchStdHz?: number;
    energyMeanDb?: number;
    pauseRatio?: number;
    speechRateApprox?: number;
    zeroCrossingRateMean?: number;
    crestFactorMean?: number;
    entropyMean?: number;
    dynamicRangeDb?: number;
    energyStdDb?: number;
    spectralFluxApprox?: number;
    pitchEndLiftHz?: number;
  };
}

// GET /api/gravacoes/:id/transcricao — Status e conteúdo da transcrição
export async function GET(_req: NextRequest, context: RouteContext) {
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
      transcricaoStatus: true,
      transcricaoTexto: true,
      transcricaoSegmentos: true,
      transcricaoErro: true,
      transcricaoAtualizadoEm: true,
    },
  });

  const getDenied = assertGravacaoAccess(
    user,
    gravacao ? { userId: gravacao.userId, vara: gravacao.vara } : null,
    "read"
  );
  if (getDenied) return getDenied;

  if (!gravacao) {
    return apiError("Gravação não encontrada.", 404);
  }

  return apiOk({
    transcricao: {
      status: gravacao.transcricaoStatus,
      texto: gravacao.transcricaoTexto,
      segmentos: parseStoredSegments(gravacao.transcricaoSegmentos),
      erro: gravacao.transcricaoErro,
      atualizadoEm: gravacao.transcricaoAtualizadoEm,
    },
  });
}

// POST /api/gravacoes/:id/transcricao — Iniciar transcrição manual
export async function POST(_req: NextRequest, context: RouteContext) {
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
      status: true,
      caminhoArquivo: true,
      transcricaoStatus: true,
      numeroProcesso: true,
      classeProcessual: true,
      partes: true,
      nomeJuiz: true,
      tipoAudiencia: true,
      dataAudiencia: true,
    },
  });

  const postDenied = assertGravacaoAccess(
    user,
    gravacao ? { userId: gravacao.userId, vara: gravacao.vara } : null,
    "read"
  );
  if (postDenied) return postDenied;

  if (!gravacao) {
    return apiError("Gravação não encontrada.", 404);
  }

  if (gravacao.transcricaoStatus === "PROCESSANDO") {
    return apiOk({
      transcricao: {
        status: gravacao.transcricaoStatus,
        texto: null,
        erro: null,
      },
      message: "A transcrição desta gravação já está em processamento.",
    });
  }

  if (gravacao.status !== "FINALIZADA" || !gravacao.caminhoArquivo) {
    return apiError("A gravação precisa estar finalizada para transcrição.", 400);
  }

  const absoluteVideoPath = path.join(UPLOAD_DIR, gravacao.caminhoArquivo);

  try {
    await validateLocalTranscriptionRuntime();
  } catch (err) {
    const message =
      err instanceof LocalTranscriptionError
        ? err.message
        : "Ambiente de transcrição não disponível.";
    return apiError(message, 500);
  }

  await prisma.gravacao.update({
    where: { id: gravacao.id },
    data: {
      transcricaoStatus: "PROCESSANDO",
      transcricaoErro: null,
      transcricaoAtualizadoEm: new Date(),
    },
  });

  const gravacaoId = gravacao.id;
  const contextualMetadata: ProcessMetadata = {
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

  void (async () => {
    try {
      const result = await transcribeLocalRecording({ inputVideoPath: absoluteVideoPath });
      const diarizedSegments = diarizeSegmentsByRole(result.segments, contextualMetadata);

      await prisma.gravacao.update({
        where: { id: gravacaoId },
        data: {
          transcricaoStatus: "CONCLUIDA",
          transcricaoTexto: result.text,
          transcricaoSegmentos: diarizedSegments as unknown as Prisma.InputJsonValue,
          transcricaoErro: null,
          transcricaoAtualizadoEm: new Date(),
        },
      });
    } catch (err) {
      const message =
        err instanceof LocalTranscriptionError
          ? err.message
          : "Falha inesperada durante a transcrição.";

      await prisma.gravacao.update({
        where: { id: gravacaoId },
        data: {
          transcricaoStatus: "ERRO",
          transcricaoErro: message,
          transcricaoAtualizadoEm: new Date(),
        },
      }).catch(() => {});
    }
  })();

  return apiOk({
    transcricao: {
      status: "PROCESSANDO",
      texto: null,
      erro: null,
    },
    message: "Transcrição iniciada em segundo plano. Consulte o status via GET.",
  });
}

// PATCH /api/gravacoes/:id/transcricao — Persistir transcrição incremental em tempo real
export async function PATCH(req: NextRequest, context: RouteContext) {
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
      transcricaoTexto: true,
      transcricaoSegmentos: true,
      numeroProcesso: true,
      classeProcessual: true,
      partes: true,
      nomeJuiz: true,
      tipoAudiencia: true,
      dataAudiencia: true,
    },
  });

  const patchTranscricaoDenied = assertGravacaoAccess(
    user,
    gravacao ? { userId: gravacao.userId, vara: gravacao.vara } : null,
    "write",
    "patch"
  );
  if (patchTranscricaoDenied) return patchTranscricaoDenied;

  if (!gravacao) {
    return apiError("Gravação não encontrada.", 404);
  }

  try {
    const body = await req.json();
    const isFinal = Boolean(body?.isFinal);
    const segments = Array.isArray(body?.segments) ? (body.segments as unknown[]) : null;
    const hasSegments = Boolean(segments && segments.length > 0);

    if (!hasSegments && !isFinal) {
      return apiError("Payload inválido: informe 'segments' com ao menos um item.", 400);
    }

    const isValid = (segments ?? []).every((segment) => {
      const candidate = segment as Partial<LiveSegmentPayload>;
      return (
        typeof candidate?.text === "string"
        && typeof candidate?.offsetMs === "number"
        && typeof candidate?.createdAt === "string"
        && (candidate?.speakerId === undefined || typeof candidate?.speakerId === "string")
        && (candidate?.role === undefined || typeof candidate?.role === "string")
        && (candidate?.confidence === undefined || typeof candidate?.confidence === "number")
        && (candidate?.startMs === undefined || typeof candidate?.startMs === "number")
        && (candidate?.endMs === undefined || typeof candidate?.endMs === "number")
        && (
          candidate?.voiceFeatures === undefined
          || (
            typeof candidate.voiceFeatures === "object"
            && candidate.voiceFeatures !== null
            && (
              (candidate.voiceFeatures.pitchMeanHz === undefined || typeof candidate.voiceFeatures.pitchMeanHz === "number")
              && (candidate.voiceFeatures.pitchStdHz === undefined || typeof candidate.voiceFeatures.pitchStdHz === "number")
              && (candidate.voiceFeatures.energyMeanDb === undefined || typeof candidate.voiceFeatures.energyMeanDb === "number")
              && (candidate.voiceFeatures.pauseRatio === undefined || typeof candidate.voiceFeatures.pauseRatio === "number")
              && (candidate.voiceFeatures.speechRateApprox === undefined || typeof candidate.voiceFeatures.speechRateApprox === "number")
              && (candidate.voiceFeatures.zeroCrossingRateMean === undefined || typeof candidate.voiceFeatures.zeroCrossingRateMean === "number")
              && (candidate.voiceFeatures.crestFactorMean === undefined || typeof candidate.voiceFeatures.crestFactorMean === "number")
              && (candidate.voiceFeatures.entropyMean === undefined || typeof candidate.voiceFeatures.entropyMean === "number")
              && (candidate.voiceFeatures.dynamicRangeDb === undefined || typeof candidate.voiceFeatures.dynamicRangeDb === "number")
              && (candidate.voiceFeatures.energyStdDb === undefined || typeof candidate.voiceFeatures.energyStdDb === "number")
              && (candidate.voiceFeatures.spectralFluxApprox === undefined || typeof candidate.voiceFeatures.spectralFluxApprox === "number")
              && (candidate.voiceFeatures.pitchEndLiftHz === undefined || typeof candidate.voiceFeatures.pitchEndLiftHz === "number")
            )
          )
        )
      );
    });

    if (!isValid) {
      return apiError("Payload inválido para segmentos de transcrição.", 400);
    }

    const contextualMetadata: ProcessMetadata = {
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

    let correctionsApplied = 0;
    const contextualSegments = ((segments ?? []) as LiveSegmentPayload[]).map((segment) => {
      const corrected = applyContextualCorrections(segment.text, contextualMetadata);
      correctionsApplied += corrected.correctionsApplied;
      return {
        ...segment,
        id: segment.id ?? `${segment.createdAt}-${segment.offsetMs}`,
        text: corrected.text,
      };
    });
    const currentSegments = parseStoredSegments(gravacao.transcricaoSegmentos);
    const diarizedIncoming = diarizeSegmentsByRole(
      contextualSegments as TranscriptSegment[],
      contextualMetadata
    );
    const mergedSegments = [...currentSegments, ...diarizedIncoming];
    const appendedText = buildTranscriptTextFromSegments(mergedSegments);
    const hasTranscriptionText = appendedText.trim().length > 0;
    const nextStatus = isFinal
      ? (hasTranscriptionText ? "CONCLUIDA" : "PENDENTE")
      : "PROCESSANDO";
    const contextHits = computeContextEntityHits(appendedText, contextualMetadata);

    const updated = await prisma.gravacao.update({
      where: { id: gravacao.id },
      data: {
        transcricaoStatus: nextStatus,
        transcricaoTexto: appendedText,
        transcricaoSegmentos: mergedSegments as unknown as Prisma.InputJsonValue,
        transcricaoErro: null,
        transcricaoAtualizadoEm: new Date(),
      },
      select: {
        transcricaoStatus: true,
        transcricaoTexto: true,
        transcricaoSegmentos: true,
        transcricaoAtualizadoEm: true,
      },
    });

    return apiOk({
      transcricao: {
        status: updated.transcricaoStatus,
        texto: updated.transcricaoTexto,
        segmentos: parseStoredSegments(updated.transcricaoSegmentos),
        atualizadoEm: updated.transcricaoAtualizadoEm,
      },
      diagnosticoContextual: {
        correctionsApplied,
        entities: contextHits,
      },
    });
  } catch {
    return apiError("Erro ao persistir transcrição em tempo real.", 500);
  }
}
