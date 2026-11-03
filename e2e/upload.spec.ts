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

  test("tenta a conversão de novo com o WebM guardado, sem novo envio", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1", status: "EM_ANDAMENTO" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const fileBuffer = await fs.readFile(SAMPLE_WEBM);
    const guardado = path.join(
      uploadDir,
      "conversoes-pendentes",
      `${grav.id}.${fileBuffer.length}.webm`
    );
    await fs.mkdir(path.dirname(guardado), { recursive: true });
    await fs.writeFile(guardado, fileBuffer);

    const outroTamanho = await api.post("/api/upload", {
      multipart: {
        mode: "retryConversion",
        gravacaoId: grav.id,
        inputBytes: String(fileBuffer.length + 1),
      },
    });
    expect(outroTamanho.status()).toBe(404);

    const res = await api.post("/api/upload", {
      multipart: {
        mode: "retryConversion",
        gravacaoId: grav.id,
        inputBytes: String(fileBuffer.length),
        duracao: "2",
      },
      timeout: 60_000,
    });
    expect(res.status()).toBe(200);
    const updated = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(updated?.status).toBe("FINALIZADA");
    expect(updated?.caminhoArquivo).toMatch(/\.mp4$/);
    await expect(fs.stat(path.join(uploadDir, updated!.caminhoArquivo!))).resolves.toBeTruthy();
    await expect(fs.stat(guardado)).rejects.toThrow();
    await api.dispose();
  });

  test("excluir a gravação apaga o WebM guardado", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1", status: "EM_ANDAMENTO" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const guardado = path.join(uploadDir, "conversoes-pendentes", `${grav.id}.123.webm`);
    await fs.mkdir(path.dirname(guardado), { recursive: true });
    await fs.writeFile(guardado, "webm");

    const res = await api.delete(`/api/gravacoes/${grav.id}`);

    expect(res.status()).toBe(200);
    await expect(fs.stat(guardado)).rejects.toThrow();
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
