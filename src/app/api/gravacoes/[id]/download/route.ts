import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { getSessionOrError } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { Readable } from "stream";
import { apiError } from "@/lib/api-response";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
const PJE_MAX_OUTPUT_SIZE_BYTES = 300 * 1024 * 1024;

function getVideoHeaders(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") {
    return { contentType: "video/mp4", extension: "mp4" };
  }
  return { contentType: "video/webm", extension: "webm" };
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/gravacoes/:id/download — Download do arquivo de vídeo
export async function GET(req: NextRequest, context: RouteContext) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  const { id } = await context.params;
  const user = session!.user;

  const gravacao = await prisma.gravacao.findUnique({ where: { id } });

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

  if (gravacao.status !== "FINALIZADA" || !gravacao.caminhoArquivo) {
    return apiError("Arquivo não disponível. A gravação não foi finalizada.", 404);
  }

  const filePath = path.join(UPLOAD_DIR, gravacao.caminhoArquivo);
  const { contentType, extension } = getVideoHeaders(filePath);

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return apiError("Arquivo não encontrado no servidor.", 404);
  }

  const fileSize = fileStat.size;
  const pjeApto = fileSize <= PJE_MAX_OUTPUT_SIZE_BYTES;
  const processoSlug = gravacao.numeroProcesso.replace(/[^0-9-]/g, "");
  const dataStr = gravacao.createdAt.toISOString().slice(0, 10);
  const downloadName = `gravacao_${processoSlug}_${dataStr}.${extension}`;

  // Handle Range requests
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      return new NextResponse("Range Not Satisfiable", { status: 416 });
    }

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      return new NextResponse("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    const chunkSize = end - start + 1;
    const nodeStream = createReadStream(filePath, { start, end });
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new NextResponse(webStream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "X-Pje-Apto": String(pjeApto),
      },
    });
  }

  // Full file download
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "X-Pje-Apto": String(pjeApto),
    },
  });
}
