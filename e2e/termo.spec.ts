import { test, expect } from "./support/test";
import {
  cleanupE2eData,
  getPrisma,
  seedGravacao,
  SEED_TRANSCRICAO_SEGMENTOS,
} from "./fixtures/db";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

async function seedGravacaoComTranscricao(numero: string = "TERMO-PROC") {
  return seedGravacao({
    ownerUsername: "servidor1",
    numeroProcesso: numero,
    transcricaoStatus: "CONCLUIDA",
    transcricaoTexto: "Está aberta a audiência. Boa tarde, excelência.",
    transcricaoSegmentos: SEED_TRANSCRICAO_SEGMENTOS,
  });
}

test.describe("Termo de Audiência", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("POST gera termo via mock Maritaca e marca CONCLUIDA", async ({ playwright }) => {
    const grav = await seedGravacaoComTranscricao();
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const post = await api.post(`/api/gravacoes/${grav.id}/termo`);
    expect(post.status()).toBe(200);

    await expect.poll(async () => {
      const row = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
      return row?.termoStatus;
    }, { timeout: 15_000 }).toBe("CONCLUIDA");

    const final = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(final?.termoTexto).toContain("Termo de Audiência");
    expect(final?.termoTipo).toBe("procedencia");
    await api.dispose();
  });

  test("POST com numeroProcesso=ERRO_FORCADO falha e marca ERRO", async ({ playwright }) => {
    const grav = await seedGravacaoComTranscricao("ERRO_FORCADO");
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const post = await api.post(`/api/gravacoes/${grav.id}/termo`);
    expect(post.status()).toBe(200);
    await expect.poll(async () => {
      const row = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
      return row?.termoStatus;
    }, { timeout: 15_000 }).toBe("ERRO");
    const final = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(final?.termoErro).toBeTruthy();
    await api.dispose();
  });

  test("POST sem transcrição retorna 400", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.post(`/api/gravacoes/${grav.id}/termo`);
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test("PATCH salva edição manual do markdown", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      termoStatus: "CONCLUIDA",
      termoTexto: "# Original",
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.patch(`/api/gravacoes/${grav.id}/termo`, {
      data: { texto: "# Editado pelo servidor" },
    });
    expect(res.status()).toBe(200);
    const row = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(row?.termoTexto).toBe("# Editado pelo servidor");
    await api.dispose();
  });

  test("GET termo por JUIZ mesma vara retorna 200", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      termoStatus: "CONCLUIDA",
      termoTexto: "# Termo",
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/juiz1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/termo`);
    expect(res.status()).toBe(200);
    await api.dispose();
  });

  test("PATCH por SERVIDOR não-dono retorna 403", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1", termoStatus: "CONCLUIDA" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor2.json",
      baseURL,
    });
    const res = await api.patch(`/api/gravacoes/${grav.id}/termo`, {
      data: { texto: "# Hack" },
    });
    expect(res.status()).toBe(403);
    await api.dispose();
  });
});
