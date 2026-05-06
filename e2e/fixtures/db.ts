import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import path from "path";
import { promises as fs } from "fs";

let _client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!_client) {
    const url = process.env.E2E_DATABASE_URL;
    if (!url) {
      throw new Error(
        "E2E_DATABASE_URL não está definido. Configure-o em .env.e2e antes de rodar a suite."
      );
    }
    _client = new PrismaClient({ datasources: { db: { url } } });
  }
  return _client;
}

export async function disconnectPrisma(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = null;
  }
}

export function e2eId(prefix: string = "grav"): string {
  return `e2e-${prefix}-${randomUUID()}`;
}

export interface SeedGravacaoInput {
  id?: string;
  ownerUsername: "servidor1" | "servidor2";
  numeroProcesso?: string;
  vara?: string | null;
  status?: "EM_ANDAMENTO" | "PAUSADA" | "FINALIZADA" | "INTERROMPIDA";
  caminhoArquivo?: string | null;
  modo?: "PRESENCIAL" | "HIBRIDO";
  transcricaoStatus?: "PENDENTE" | "PROCESSANDO" | "CONCLUIDA" | "ERRO";
  transcricaoTexto?: string | null;
  transcricaoSegmentos?: unknown;
  termoStatus?: "PENDENTE" | "PROCESSANDO" | "CONCLUIDA" | "ERRO";
  termoTexto?: string | null;
}

export async function seedGravacao(input: SeedGravacaoInput) {
  const prisma = getPrisma();
  const owner = await prisma.user.findUnique({ where: { username: input.ownerUsername } });
  if (!owner) {
    throw new Error(
      `Usuário ${input.ownerUsername} não encontrado. Rode 'npm run test:e2e:setup' primeiro.`
    );
  }
  return prisma.gravacao.create({
    data: {
      id: input.id ?? e2eId(),
      numeroProcesso: input.numeroProcesso ?? `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      modo: input.modo ?? "PRESENCIAL",
      status: input.status ?? "EM_ANDAMENTO",
      vara: input.vara === undefined ? owner.vara : input.vara,
      caminhoArquivo: input.caminhoArquivo ?? null,
      transcricaoStatus: input.transcricaoStatus ?? "PENDENTE",
      transcricaoTexto: input.transcricaoTexto ?? null,
      transcricaoSegmentos:
        input.transcricaoSegmentos === undefined
          ? Prisma.JsonNull
          : (input.transcricaoSegmentos as Prisma.InputJsonValue),
      termoStatus: input.termoStatus ?? "PENDENTE",
      termoTexto: input.termoTexto ?? null,
      userId: owner.id,
    },
  });
}

export const SEED_TRANSCRICAO_SEGMENTOS = [
  {
    id: "seg-1",
    text: "Está aberta a audiência.",
    offsetMs: 0,
    createdAt: new Date(0).toISOString(),
    role: "JUIZ",
    speakerId: "S1",
    startMs: 0,
    endMs: 1500,
  },
  {
    id: "seg-2",
    text: "Boa tarde, excelência.",
    offsetMs: 2000,
    createdAt: new Date(0).toISOString(),
    role: "PARTE",
    speakerId: "S2",
    startMs: 2000,
    endMs: 3500,
  },
];

export async function cleanupE2eData(): Promise<void> {
  const prisma = getPrisma();
  await prisma.gravacao.deleteMany({ where: { id: { startsWith: "e2e-" } } });
}

export async function ensureUploadDir(uploadDir: string): Promise<void> {
  await fs.mkdir(uploadDir, { recursive: true });
}

export async function placeMp4Fixture(
  uploadDir: string,
  fixturePath: string,
  relativePath: string
): Promise<void> {
  const target = path.join(uploadDir, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(fixturePath, target);
}
