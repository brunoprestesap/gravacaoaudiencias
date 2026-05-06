import path from "path";
import { test, expect } from "./support/test";
import { cleanupE2eData, placeMp4Fixture, seedGravacao } from "./fixtures/db";
import { SAMPLE_MP4 } from "./fixtures/files";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

async function seedGravacaoFinalizadaComMp4(uploadDir: string) {
  const relativePath = path.join("2026", "05", "3-vara-federal", "sample.mp4");
  const grav = await seedGravacao({
    ownerUsername: "servidor1",
    status: "FINALIZADA",
    caminhoArquivo: relativePath,
  });
  await placeMp4Fixture(uploadDir, SAMPLE_MP4, relativePath);
  return grav;
}

test.describe("Reprodução", () => {
  test.afterEach(async () => {
    await cleanupE2eData();
  });

  test("página de reprodução renderiza video element", async ({ browser }) => {
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const grav = await seedGravacaoFinalizadaComMp4(uploadDir);
    const ctx = await browser.newContext({ storageState: "e2e/.auth/servidor1.json" });
    const page = await ctx.newPage();
    await page.goto(`/gravacao/${grav.id}/reproduzir`);
    const video = page.locator("video");
    await expect(video).toBeVisible({ timeout: 15_000 });
    const src = await video.getAttribute("src");
    expect(src).toContain(`/api/gravacoes/${grav.id}/stream`);
    await ctx.close();
  });

  test("GET /stream com Range retorna 206", async ({ playwright }) => {
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const grav = await seedGravacaoFinalizadaComMp4(uploadDir);
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/stream`, {
      headers: { Range: "bytes=0-1023" },
    });
    expect(res.status()).toBe(206);
    expect(res.headers()["content-range"]).toMatch(/^bytes 0-1023\//);
    await api.dispose();
  });

  test("JUIZ da mesma vara consegue acessar stream", async ({ playwright }) => {
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const grav = await seedGravacaoFinalizadaComMp4(uploadDir);
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/juiz1.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/stream`);
    expect([200, 206]).toContain(res.status());
    await api.dispose();
  });

  test("SERVIDOR de outra vara recebe 403", async ({ playwright }) => {
    const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
    const relativePath = path.join("2026", "05", "outra-vara", "sample.mp4");
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      status: "FINALIZADA",
      caminhoArquivo: relativePath,
      vara: "Outra Vara Federal",
    });
    await placeMp4Fixture(uploadDir, SAMPLE_MP4, relativePath);
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor2.json",
      baseURL,
    });
    const res = await api.get(`/api/gravacoes/${grav.id}/stream`);
    expect(res.status()).toBe(403);
    await api.dispose();
  });
});
