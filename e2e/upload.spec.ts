import { promises as fs } from "fs";
import path from "path";
import { test, expect } from "./support/test";
import { cleanupE2eData, getPrisma, seedGravacao } from "./fixtures/db";
import { SAMPLE_WEBM } from "./fixtures/files";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("Upload de gravação", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("POST /api/upload com WebM válido converte para MP4 e atualiza Gravacao", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1", status: "EM_ANDAMENTO" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const fileBuffer = await fs.readFile(SAMPLE_WEBM);
    const res = await api.post("/api/upload", {
      multipart: {
        gravacaoId: grav.id,
        duracao: "2",
        file: {
          name: "sample.webm",
          mimeType: "video/webm",
          buffer: fileBuffer,
        },
      },
      timeout: 60_000,
    });
    expect(res.status()).toBe(200);
    const updated = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(updated?.status).toBe("FINALIZADA");
    expect(updated?.caminhoArquivo).toMatch(/\.mp4$/);
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const absolutePath = path.join(uploadDir, updated!.caminhoArquivo!);
    const stat = await fs.stat(absolutePath).catch((e) => {
      throw new Error(`Esperava arquivo em ${absolutePath} (caminho relativo: ${updated?.caminhoArquivo}). Erro: ${e.message}`);
    });
    expect(stat.size).toBeGreaterThan(0);
    await api.dispose();
  });

  test("upload sem ser dono retorna 403", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor2.json",
      baseURL,
    });
    const fileBuffer = await fs.readFile(SAMPLE_WEBM);
    const res = await api.post("/api/upload", {
      multipart: {
        gravacaoId: grav.id,
        file: { name: "sample.webm", mimeType: "video/webm", buffer: fileBuffer },
      },
      timeout: 60_000,
    });
    expect(res.status()).toBe(403);
    await api.dispose();
  });

  test("upload sem arquivo retorna 400", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.post("/api/upload", {
      multipart: { gravacaoId: grav.id },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test("upload sem gravacaoId retorna 400", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const fileBuffer = await fs.readFile(SAMPLE_WEBM);
    const res = await api.post("/api/upload", {
      multipart: {
        file: { name: "sample.webm", mimeType: "video/webm", buffer: fileBuffer },
      },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });
});
