import { test, expect } from "./support/test";
import { cleanupE2eData, seedGravacao } from "./fixtures/db";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("Controle de acesso", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("JUIZ é redirecionado ao tentar /gravacao/nova", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/juiz1.json" });
    const page = await ctx.newPage();
    await page.goto("/gravacao/nova");
    await expect(page).toHaveURL(/\/dashboard$/);
    await ctx.close();
  });

  test("JUIZ recebe 403 ao tentar criar gravação via API", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/juiz1.json",
      baseURL,
    });
    const res = await api.post("/api/gravacoes", {
      data: { metadata: { numeroProcesso: "0000-X" }, modo: "PRESENCIAL" },
    });
    expect(res.status()).toBe(403);
    await api.dispose();
  });

  test("SERVIDOR2 não consegue alterar gravação criada por SERVIDOR1", async ({ playwright }) => {
    const owned = await seedGravacao({ ownerUsername: "servidor1" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor2.json",
      baseURL,
    });
    const patch = await api.patch(`/api/gravacoes/${owned.id}`, {
      data: { numeroProcesso: "ALTERADO" },
    });
    expect(patch.status()).toBe(403);
    const del = await api.delete(`/api/gravacoes/${owned.id}`);
    expect(del.status()).toBe(403);
    await api.dispose();
  });

  test("SERVIDOR2 não vê gravações de SERVIDOR1 na listagem", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      numeroProcesso: "GRAV-DO-SERVIDOR1",
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor2.json",
      baseURL,
    });
    const res = await api.get("/api/gravacoes?limit=100");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { gravacoes: Array<{ id: string }> };
    expect(body.gravacoes.find((g) => g.id === grav.id)).toBeUndefined();
    await api.dispose();
  });

  test("JUIZ vê gravações de qualquer servidor da sua vara", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      numeroProcesso: "GRAV-VISIVEL-AO-JUIZ",
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/juiz1.json",
      baseURL,
    });
    const res = await api.get("/api/gravacoes?limit=100");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { gravacoes: Array<{ id: string }> };
    expect(body.gravacoes.find((g) => g.id === grav.id)).toBeDefined();
    await api.dispose();
  });
});
