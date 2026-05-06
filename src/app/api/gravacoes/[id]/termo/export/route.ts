import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getSessionOrError } from "@/lib/api-auth";
import { assertGravacaoAccess } from "@/lib/gravacao-access";
import { prisma } from "@/lib/db";
import {
  renderTermoDocx,
  renderTermoPdf,
  type TermoHeader,
} from "@/lib/termo-audiencia/render";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "termo";
}

// GET /api/gravacoes/:id/termo/export?formato=pdf|docx
export async function GET(req: NextRequest, context: RouteContext) {
  const { session, error } = await getSessionOrError();
  if (error) return error;

  const { id } = await context.params;
  const user = session!.user;
  const formato = (req.nextUrl.searchParams.get("formato") || "pdf").toLowerCase();
  if (formato !== "pdf" && formato !== "docx") {
    return apiError("Formato inválido. Use 'pdf' ou 'docx'.", 400);
  }

  const gravacao = await prisma.gravacao.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      vara: true,
      numeroProcesso: true,
      partes: true,
      classeProcessual: true,
      tipoAudiencia: true,
      termoTexto: true,
      termoStatus: true,
    },
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

  if (
    gravacao.termoStatus !== "CONCLUIDA"
    || !gravacao.termoTexto
    || gravacao.termoTexto.trim().length === 0
  ) {
    return apiError("Termo de audiência ainda não está disponível.", 400);
  }

  const header: TermoHeader = {
    numeroProcesso: gravacao.numeroProcesso,
    partes: gravacao.partes,
    vara: gravacao.vara,
    classeProcessual: gravacao.classeProcessual,
    tipoAudiencia: gravacao.tipoAudiencia,
  };

  const baseName = sanitizeFileName(`termo-${gravacao.numeroProcesso}`);

  if (formato === "pdf") {
    const buffer = await renderTermoPdf(gravacao.termoTexto, header);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
      },
    });
  }

  const buffer = await renderTermoDocx(gravacao.termoTexto, header);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${baseName}.docx"`,
    },
  });
}
