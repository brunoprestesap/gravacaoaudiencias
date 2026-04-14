import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, mkdtemp, rm } from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import os from "os";
import { getSessionOrError } from "@/lib/api-auth";
import { assertGravacaoAccess } from "@/lib/gravacao-access";
import { prisma } from "@/lib/db";
import { PJE_MAX_OUTPUT_SIZE_BYTES } from "@/lib/upload-encoding";
import {
  assertFfmpegAvailable,
  transcodeWebmToMp4Adaptive,
  type EncodingDiagnostics,
  type ConversionTimings,
} from "@/lib/upload-ffmpeg";
import { apiError } from "@/lib/api-response";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB de entrada
const ENABLE_UPLOAD_DEBUG_LOGS =
  process.env.NODE_ENV !== "production" &&
  process.env.UPLOAD_DEBUG_LOGS !== "false";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function uploadDebugLog(message: string, data: Record<string, unknown>) {
  if (!ENABLE_UPLOAD_DEBUG_LOGS) return;
  console.info(message, data);
}

async function writeWebFileToPath(file: File, outputPath: string): Promise<void> {
  const reader = file.stream().getReader();
  const writer = createWriteStream(outputPath);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await new Promise<void>((resolve, reject) => {
        writer.write(Buffer.from(value), (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  } finally {
    await new Promise<void>((resolve) => writer.end(resolve));
    reader.releaseLock();
  }
}

function buildOutputPath(
  gravacao: {
    id: string;
    vara: string | null;
    numeroProcesso: string;
  },
  extension: "webm" | "mp4" = "webm"
) {
  const now = new Date();
  const ano = now.getFullYear().toString();
  const mes = String(now.getMonth() + 1).padStart(2, "0");
  const varaSlug = slugify(gravacao.vara || "sem-vara");
  const processoSlug = gravacao.numeroProcesso.replace(/[^0-9-]/g, "");
  const dataStr = `${ano}-${mes}-${String(now.getDate()).padStart(2, "0")}`;
  const filename = `${gravacao.id}_${processoSlug}_${dataStr}.${extension}`;
  const relativePath = path.join(ano, mes, varaSlug, filename);
  const fullDir = path.join(UPLOAD_DIR, ano, mes, varaSlug);
  const fullPath = path.join(UPLOAD_DIR, relativePath);

  return { relativePath, fullDir, fullPath };
}

async function remuxRecoverySegments(segments: File[], outputPath: string) {
  if (segments.length === 0) {
    throw new Error("NO_SEGMENTS");
  }

  await assertFfmpegAvailable();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audiencia-remux-"));

  try {
    const sortedSegments = [...segments].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );

    const segmentPaths: string[] = [];
    for (let i = 0; i < sortedSegments.length; i++) {
      const segment = sortedSegments[i];
      const segmentPath = path.join(tempDir, `part-${String(i).padStart(6, "0")}.webm`);
      await writeWebFileToPath(segment, segmentPath);
      segmentPaths.push(segmentPath);
    }

    const listPath = path.join(tempDir, "segments.txt");
    const concatList = segmentPaths
      .map((segmentPath) => `file '${segmentPath.replace(/'/g, "'\\''")}'`)
      .join("\n");
    await writeFile(listPath, `${concatList}\n`, "utf-8");

    // Use execFile directly via assertFfmpegAvailable-validated ffmpeg
    const { execFile } = await import("child_process");
    await new Promise<void>((resolve, reject) => {
      execFile("ffmpeg", [
        "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath,
      ], (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  try {
    const requestStart = Date.now();
    let findGravacaoMs = 0;
    let persistInputMs = 0;
    let updateDbMs = 0;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const segments = formData.getAll("segments").filter((entry): entry is File => entry instanceof File);
    const mode = formData.get("mode") as string | null;
    const gravacaoId = formData.get("gravacaoId") as string | null;
    const duracao = formData.get("duracao") as string | null;

    if (!gravacaoId) {
      return apiError("gravacaoId é obrigatório.", 400);
    }

    const isRecoverySegmentsMode = mode === "recoverySegments";

    uploadDebugLog("[upload] incoming request", {
      gravacaoId,
      mode: mode ?? null,
      isRecoverySegmentsMode,
      segmentCount: segments.length,
      hasSingleFile: Boolean(file),
    });

    if (!isRecoverySegmentsMode && !file) {
      return apiError("Arquivo é obrigatório para upload padrão.", 400);
    }
    if (isRecoverySegmentsMode && segments.length === 0) {
      return apiError("Segmentos de recuperação são obrigatórios.", 400);
    }

    // Validate file type
    if (file && !file.type.startsWith("video/webm") && !file.type.startsWith("video/")) {
      return apiError("Formato de arquivo não suportado. Envie um arquivo video/webm.", 415);
    }
    if (isRecoverySegmentsMode) {
      const hasInvalidSegment = segments.some(
        (segment) => !segment.type.startsWith("video/webm") && !segment.type.startsWith("video/")
      );
      if (hasInvalidSegment) {
        return apiError("Todos os segmentos devem ser arquivos de vídeo válidos.", 415);
      }
    }

    // Validate file size
    if (file && file.size > MAX_FILE_SIZE) {
      return apiError("Arquivo excede o tamanho máximo de entrada (2GB).", 413);
    }
    if (isRecoverySegmentsMode) {
      const totalSegmentsSize = segments.reduce((sum, segment) => sum + segment.size, 0);
      if (totalSegmentsSize > MAX_FILE_SIZE) {
        return apiError("Segmentos excedem o tamanho máximo de entrada (2GB).", 413);
      }
    }

    // Find the gravação record
    const findGravacaoStart = Date.now();
    const gravacao = await prisma.gravacao.findUnique({ where: { id: gravacaoId } });
    findGravacaoMs = Date.now() - findGravacaoStart;

    if (!gravacao) {
      return apiError("Gravação não encontrada.", 404);
    }

    const uploadDenied = assertGravacaoAccess(
      session!.user,
      { userId: gravacao.userId, vara: gravacao.vara },
      "write",
      "upload"
    );
    if (uploadDenied) return uploadDenied;

    const webmOutput = buildOutputPath(gravacao, "webm");
    const mp4Output = buildOutputPath(gravacao, "mp4");

    // Create directories
    await mkdir(webmOutput.fullDir, { recursive: true });

    let fileSize = 0;
    let exceededPjeLimit = false;
    let warning: string | null = null;
    let diagnostics: EncodingDiagnostics | null = null;
    let conversionTimings: ConversionTimings | null = null;
    const parsedDuration = duracao ? parseInt(duracao, 10) : NaN;
    let finalDuration = Number.isFinite(parsedDuration) ? parsedDuration : null;

    if (isRecoverySegmentsMode) {
      try {
        uploadDebugLog("[upload] recovery segments mode selected", {
          gravacaoId,
          segmentCount: segments.length,
        });
        const persistStart = Date.now();
        await remuxRecoverySegments(segments, webmOutput.fullPath);
        persistInputMs = Date.now() - persistStart;
        uploadDebugLog("[upload] recovery remux success", {
          gravacaoId,
          segmentCount: segments.length,
          outputPath: webmOutput.fullPath,
        });
      } catch (remuxError) {
        console.error("[upload] recovery remux failed", {
          gravacaoId,
          segmentCount: segments.length,
          error: remuxError instanceof Error ? remuxError.message : String(remuxError),
        });
        if (remuxError instanceof Error && remuxError.message === "FFMPEG_NOT_AVAILABLE") {
          return apiError("FFmpeg não está disponível no servidor para remux de segmentos de recuperação.", 500);
        }
        return apiError("Falha ao processar segmentos de recuperação. Os dados locais foram preservados.", 500);
      }
    } else {
      const persistStart = Date.now();
      await writeWebFileToPath(file!, webmOutput.fullPath);
      persistInputMs = Date.now() - persistStart;
      uploadDebugLog("[upload] standard single-file upload success", {
        gravacaoId,
        fileSize: file!.size,
        outputPath: webmOutput.fullPath,
      });
    }

    try {
      const transcodeResult = await transcodeWebmToMp4Adaptive(
        webmOutput.fullPath,
        mp4Output.fullPath,
        finalDuration
      );
      fileSize = transcodeResult.fileSize;
      exceededPjeLimit = transcodeResult.exceededPjeLimit;
      warning = transcodeResult.warning;
      diagnostics = transcodeResult.diagnostics;
      conversionTimings = transcodeResult.timings;
      if (!finalDuration) {
        finalDuration = transcodeResult.durationSeconds;
      }
      uploadDebugLog("[upload] mp4 transcode success", {
        gravacaoId,
        outputPath: mp4Output.fullPath,
        fileSize,
        exceededPjeLimit,
        diagnostics,
        timings: conversionTimings,
      });
    } catch (transcodeError) {
      console.error("[upload] mp4 transcode failed", {
        gravacaoId,
        inputPath: webmOutput.fullPath,
        outputPath: mp4Output.fullPath,
        error: transcodeError instanceof Error ? transcodeError.message : String(transcodeError),
      });
      if (transcodeError instanceof Error && transcodeError.message === "FFMPEG_NOT_AVAILABLE") {
        return apiError("FFmpeg não está disponível no servidor para conversão para MP4.", 500);
      }
      return apiError("Falha ao converter gravação para MP4.", 500);
    } finally {
      await rm(webmOutput.fullPath, { force: true });
    }

    // Update gravação record
    const updateDbStart = Date.now();
    await prisma.gravacao.update({
      where: { id: gravacaoId },
      data: {
        caminhoArquivo: mp4Output.relativePath,
        tamanhoArquivo: fileSize,
        status: "FINALIZADA",
        duracao: finalDuration,
      },
    });
    updateDbMs = Date.now() - updateDbStart;

    const stageTimings = {
      findGravacaoMs,
      persistInputMs,
      conversion: conversionTimings,
      updateDbMs,
      requestTotalMs: Date.now() - requestStart,
    };
    uploadDebugLog("[upload] stage timings", { gravacaoId, timings: stageTimings });

    return NextResponse.json({
      success: true,
      filePath: mp4Output.relativePath,
      fileSize,
      encoding: diagnostics,
      timings: stageTimings,
      pje: {
        maxBytes: PJE_MAX_OUTPUT_SIZE_BYTES,
        apto: !exceededPjeLimit,
      },
      warning,
    });
  } catch (err) {
    console.error("Erro no upload:", err);
    return apiError("Erro interno ao salvar arquivo.", 500);
  }
}

// Increase body size limit for Next.js App Router
export const maxDuration = 300;
export const dynamic = "force-dynamic";
