import path from "path";
import { test, expect } from "./support/test";
import {
  cleanupE2eData,
  getPrisma,
  placeMp4Fixture,
  seedGravacao,
  SEED_TRANSCRICAO_SEGMENTOS,
} from "./fixtures/db";
import { SAMPLE_MP4 } from "./fixtures/files";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("Transcrição", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("GET retorna 404 quando gravação inexistente", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.get("/api/gravacoes/e2e-inexistente/transcricao");
    expect(res.status()).toBe(404);
    await api.dispose();
  });

  test("GET retorna segmentos seedados para JUIZ da mesma vara", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      transcricaoStatus: "CONCLUIDA",
      transcricaoTexto: "Está aberta a audiência. Boa tarde, excelência.",
      transcricaoSegmentos: SEED_TRANSCRICAO_SEGMENTOS,
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/juiz1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/transcricao`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      transcricao: { status: string; segmentos: unknown[] };
    };
    expect(body.transcricao.status).toBe("CONCLUIDA");
    expect(body.transcricao.segmentos.length).toBeGreaterThanOrEqual(2);
    await api.dispose();
  });

  test("POST por dono dispara motor mock e atualiza para CONCLUIDA", async ({ playwright }) => {
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const relativePath = path.join("2026", "05", "3-vara-federal", "transcrever.mp4");
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      status: "FINALIZADA",
      caminhoArquivo: relativePath,
    });
    await placeMp4Fixture(uploadDir, SAMPLE_MP4, relativePath);

    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const post = await api.post(`/api/gravacoes/${grav.id}/transcricao`);
    expect(post.status()).toBe(200);

    await expect.poll(async () => {
      const row = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
      return row?.transcricaoStatus;
    }, { timeout: 30_000 }).toBe("CONCLUIDA");

    const final = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(final?.transcricaoTexto).toContain("Está aberta a audiência");
    expect(final?.transcricaoSegmentos).not.toBeNull();
    await api.dispose();
  });

  test("POST por SERVIDOR não-dono retorna 403", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      status: "FINALIZADA",
      caminhoArquivo: "fake/path.mp4",
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor2.json",
      baseURL,
    });
    const res = await api.post(`/api/gravacoes/${grav.id}/transcricao`);
    expect(res.status()).toBe(403);
    await api.dispose();
  });

  test("PATCH realtime aceita segmento incremental do dono", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.patch(`/api/gravacoes/${grav.id}/transcricao`, {
      data: {
        segments: [
          {
            id: "live-1",
            text: "Frase parcial",
            offsetMs: 1000,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect([200, 201]).toContain(res.status());
    await api.dispose();
  });
});
