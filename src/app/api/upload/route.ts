import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getSessionOrError } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const gravacaoId = formData.get("gravacaoId") as string | null;
    const duracao = formData.get("duracao") as string | null;

    if (!file || !gravacaoId) {
      return NextResponse.json(
        { error: "Arquivo e gravacaoId são obrigatórios." },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.type.startsWith("video/webm") && !file.type.startsWith("video/")) {
      return NextResponse.json(
        { error: "Formato de arquivo não suportado. Envie um arquivo video/webm." },
        { status: 415 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Arquivo excede o tamanho máximo de 10GB." },
        { status: 413 }
      );
    }

    // Find the gravação record
    const gravacao = await prisma.gravacao.findUnique({
      where: { id: gravacaoId },
    });

    if (!gravacao) {
      return NextResponse.json(
        { error: "Gravação não encontrada." },
        { status: 404 }
      );
    }

    // Build organized path: {ano}/{mes}/{vara}/{gravacaoId}_{processo}_{data}.webm
    const now = new Date();
    const ano = now.getFullYear().toString();
    const mes = String(now.getMonth() + 1).padStart(2, "0");
    const varaSlug = slugify(gravacao.vara || "sem-vara");
    const processoSlug = gravacao.numeroProcesso.replace(/[^0-9-]/g, "");
    const dataStr = `${ano}-${mes}-${String(now.getDate()).padStart(2, "0")}`;
    const filename = `${gravacaoId}_${processoSlug}_${dataStr}.webm`;
    const relativePath = path.join(ano, mes, varaSlug, filename);
    const fullDir = path.join(UPLOAD_DIR, ano, mes, varaSlug);
    const fullPath = path.join(UPLOAD_DIR, relativePath);

    // Create directories
    await mkdir(fullDir, { recursive: true });

    // Write file using streaming (read as ArrayBuffer in chunks)
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(fullPath, buffer);

    const fileSize = buffer.length;

    // Update gravação record
    await prisma.gravacao.update({
      where: { id: gravacaoId },
      data: {
        caminhoArquivo: relativePath,
        tamanhoArquivo: fileSize,
        status: "FINALIZADA",
        duracao: duracao ? parseInt(duracao, 10) : null,
      },
    });

    return NextResponse.json({
      success: true,
      filePath: relativePath,
      fileSize,
    });
  } catch (err) {
    console.error("Erro no upload:", err);
    return NextResponse.json(
      { error: "Erro interno ao salvar arquivo." },
      { status: 500 }
    );
  }
}

// Increase body size limit for Next.js App Router
export const maxDuration = 300;
export const dynamic = "force-dynamic";
