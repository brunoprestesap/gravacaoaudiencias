import { test, expect } from "./support/test";
import { cleanupE2eData, e2eId } from "./fixtures/db";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("API gravações — CRUD", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("POST /api/gravacoes cria registro com campos válidos", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const id = e2eId();
    const res = await api.post("/api/gravacoes", {
      data: {
        id,
        metadata: { numeroProcesso: "001-CRIADO", classeProcessual: "Cível" },
        modo: "PRESENCIAL",
      },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { gravacao: { id: string; numeroProcesso: string } };
    expect(body.gravacao.id).toBe(id);
    expect(body.gravacao.numeroProcesso).toBe("001-CRIADO");
    await api.dispose();
  });

  test("POST /api/gravacoes retorna 400 sem numeroProcesso", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.post("/api/gravacoes", {
      data: { id: e2eId(), metadata: {}, modo: "PRESENCIAL" },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test("PATCH /api/gravacoes/:id atualiza status/duracao do dono", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const id = e2eId();
    await api.post("/api/gravacoes", {
      data: { id, metadata: { numeroProcesso: "PROC-PATCH" }, modo: "PRESENCIAL" },
    });
    const res = await api.patch(`/api/gravacoes/${id}`, {
      data: { status: "PAUSADA", duracao: 123 },
    });
    expect(res.status()).toBe(200);
    const get = await api.get(`/api/gravacoes/${id}`);
    const body = (await get.json()) as { gravacao: { status: string; duracao: number } };
    expect(body.gravacao.status).toBe("PAUSADA");
    expect(body.gravacao.duracao).toBe(123);
    await api.dispose();
  });

  test("DELETE remove gravação do dono", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const id = e2eId();
    await api.post("/api/gravacoes", {
      data: { id, metadata: { numeroProcesso: "PRA-DELETAR" }, modo: "PRESENCIAL" },
    });
    const del = await api.delete(`/api/gravacoes/${id}`);
    expect(del.status()).toBe(200);
    const get = await api.get(`/api/gravacoes/${id}`);
    expect(get.status()).toBe(404);
    await api.dispose();
  });
});
