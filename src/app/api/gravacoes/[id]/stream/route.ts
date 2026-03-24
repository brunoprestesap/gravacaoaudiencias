import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { getSessionOrError } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { Readable } from "stream";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
const PJE_MAX_OUTPUT_SIZE_BYTES = 300 * 1024 * 1024;

function getVideoContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  return "video/webm";
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/gravacoes/:id/stream — Stream para reprodução in-app
export async function GET(req: NextRequest, context: RouteContext) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  const { id } = await context.params;
  const user = session!.user;

  const gravacao = await prisma.gravacao.findUnique({ where: { id } });

  if (!gravacao) {
    return NextResponse.json(
      { error: "Gravação não encontrada." },
      { status: 404 }
    );
  }

  // Access control
  if (user.role === "SERVIDOR" && gravacao.userId !== user.id) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }
  if (user.role === "JUIZ" && user.vara && gravacao.vara !== user.vara) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  if (gravacao.status !== "FINALIZADA" || !gravacao.caminhoArquivo) {
    return NextResponse.json(
      { error: "Arquivo não disponível." },
      { status: 404 }
    );
  }

  const filePath = path.join(UPLOAD_DIR, gravacao.caminhoArquivo);
  const contentType = getVideoContentType(filePath);

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return NextResponse.json(
      { error: "Arquivo não encontrado no servidor." },
      { status: 404 }
    );
  }

  const fileSize = fileStat.size;
  const pjeApto = fileSize <= PJE_MAX_OUTPUT_SIZE_BYTES;

  // Handle Range requests (essential for video seek)
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      return new NextResponse("Range Not Satisfiable", { status: 416 });
    }

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);

    if (start >= fileSize) {
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
        "Content-Disposition": "inline",
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "X-Pje-Apto": String(pjeApto),
      },
    });
  }

  // Full file stream
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "X-Pje-Apto": String(pjeApto),
    },
  });
}
