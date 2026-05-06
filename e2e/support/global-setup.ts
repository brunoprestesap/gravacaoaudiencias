import { request } from "@playwright/test";
import { promises as fs } from "fs";
import path from "path";
import { startMaritacaMock } from "../fixtures/maritaca-mock";
import { cleanupE2eData, disconnectPrisma, ensureUploadDir, getPrisma } from "../fixtures/db";

const AUTH_DIR = path.join(__dirname, "..", ".auth");

const USERS = [
  { username: "servidor1", password: "senha123", file: "servidor1.json" },
  { username: "servidor2", password: "senha123", file: "servidor2.json" },
  { username: "juiz1", password: "senha123", file: "juiz1.json" },
] as const;

async function loginAndSaveStorageState(
  baseURL: string,
  username: string,
  password: string,
  outputFile: string
): Promise<void> {
  const ctx = await request.newContext({ baseURL });

  const csrfRes = await ctx.get("/api/auth/csrf");
  const csrfBody = (await csrfRes.json()) as { csrfToken: string };

  const callbackRes = await ctx.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrfBody.csrfToken,
      username,
      password,
      callbackUrl: `${baseURL}/dashboard`,
      json: "true",
    },
  });

  if (callbackRes.status() >= 400) {
    const text = await callbackRes.text();
    throw new Error(`Login falhou para ${username}: HTTP ${callbackRes.status()} ${text.slice(0, 200)}`);
  }

  const sessionRes = await ctx.get("/api/auth/session");
  const sessionBody = (await sessionRes.json()) as { user?: { username?: string } };
  if (!sessionBody.user?.username) {
    throw new Error(`Sessão de ${username} não foi estabelecida.`);
  }

  await ctx.storageState({ path: path.join(AUTH_DIR, outputFile) });
  await ctx.dispose();
}

export default async function globalSetup(): Promise<void> {
  if (!process.env.E2E_DATABASE_URL) {
    throw new Error(
      "E2E_DATABASE_URL não está definido. Copie .env.e2e.example para .env.e2e e ajuste."
    );
  }

  const prisma = getPrisma();
  const servidor = await prisma.user.findUnique({ where: { username: "servidor1" } });
  if (!servidor) {
    throw new Error(
      "Usuário 'servidor1' não encontrado. Rode 'npm run test:e2e:setup' antes da suite."
    );
  }

  await cleanupE2eData();

  const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
  await ensureUploadDir(uploadDir);

  const mock = await startMaritacaMock();
  (globalThis as { __maritacaMock?: typeof mock }).__maritacaMock = mock;

  await fs.mkdir(AUTH_DIR, { recursive: true });
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

  for (const u of USERS) {
    await loginAndSaveStorageState(baseURL, u.username, u.password, u.file);
  }

  await disconnectPrisma();
}
