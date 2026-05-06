import { test, expect } from "./support/test";
import { cleanupE2eData, seedGravacao } from "./fixtures/db";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

const MARKDOWN = "# Termo de Audiência\n\n## Presentes\n- Juiz: Carlos\n\n## Dispositivo\na) Procedente.";

test.describe("Termo — export", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("export PDF retorna application/pdf com bytes", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      termoStatus: "CONCLUIDA",
      termoTexto: MARKDOWN,
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/termo/export?formato=pdf`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    const body = await res.body();
    expect(body.length).toBeGreaterThan(1024);
    expect(body.slice(0, 4).toString("ascii")).toBe("%PDF");
    await api.dispose();
  });

  test("export DOCX retorna content-type Word", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      termoStatus: "CONCLUIDA",
      termoTexto: MARKDOWN,
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/termo/export?formato=docx`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    const body = await res.body();
    expect(body.length).toBeGreaterThan(1024);
    expect(body.slice(0, 2).toString("ascii")).toBe("PK");
    await api.dispose();
  });

  test("export sem termo retorna 400", async ({ playwright }) => {
    const grav = await seedGravacao({ ownerUsername: "servidor1" });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/termo/export?formato=pdf`);
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test("formato inválido retorna 400", async ({ playwright }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      termoStatus: "CONCLUIDA",
      termoTexto: MARKDOWN,
    });
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/termo/export?formato=xyz`);
    expect(res.status()).toBe(400);
    await api.dispose();
  });
});
