import { test, expect } from "./support/test";
import { cleanupE2eData, getPrisma, seedGravacao } from "./fixtures/db";

test.describe("Consulta de gravações", () => {
  test.use({ storageState: "e2e/.auth/servidor1.json" });

  test.afterEach(async () => {
    await cleanupE2eData();
  });

  async function gotoConsulta(page: import("@playwright/test").Page) {
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/gravacoes") && r.request().method() === "GET",
      { timeout: 30_000 }
    );
    await page.goto("/consulta");
    await responsePromise;
  }

  test("vazio mostra empty state", async ({ page }) => {
    await gotoConsulta(page);
    await expect(page.getByText(/Nenhuma gravação encontrada/i)).toBeVisible({ timeout: 10_000 });
  });

  test("lista gravações próprias após seed", async ({ page }) => {
    await seedGravacao({
      ownerUsername: "servidor1",
      numeroProcesso: "PROC-VISIVEL",
      status: "FINALIZADA",
    });
    await gotoConsulta(page);
    await expect(page.getByText("PROC-VISIVEL")).toBeVisible({ timeout: 10_000 });
  });

  test("busca por numeroProcesso filtra a tabela (debounced)", async ({ page }) => {
    await seedGravacao({ ownerUsername: "servidor1", numeroProcesso: "AAAA-111" });
    await seedGravacao({ ownerUsername: "servidor1", numeroProcesso: "BBBB-222" });
    await gotoConsulta(page);
    await expect(page.getByText("AAAA-111")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("BBBB-222")).toBeVisible();
    await page.getByPlaceholder(/Buscar por número do processo/i).fill("AAAA");
    await expect.poll(async () => page.getByText("BBBB-222").count(), { timeout: 5000 }).toBe(0);
    await expect(page.getByText("AAAA-111")).toBeVisible();
  });

  test("modal de exclusão remove gravação", async ({ page }) => {
    const grav = await seedGravacao({
      ownerUsername: "servidor1",
      numeroProcesso: "PARA-EXCLUIR",
      status: "FINALIZADA",
    });
    await gotoConsulta(page);
    await expect(page.getByText("PARA-EXCLUIR")).toBeVisible({ timeout: 10_000 });
    const row = page.getByRole("row").filter({ hasText: "PARA-EXCLUIR" });
    await row.getByRole("button", { name: /Excluir/i }).click();
    const modal = page.locator("div").filter({ hasText: /Excluir gravação/i }).last();
    await modal.getByRole("button", { name: "Excluir", exact: true }).click();
    await expect(page.getByText("PARA-EXCLUIR")).toHaveCount(0);
    const stillThere = await getPrisma().gravacao.findUnique({ where: { id: grav.id } });
    expect(stillThere).toBeNull();
  });

  test("paginação aparece com 25 gravações", async ({ page }) => {
    for (let i = 0; i < 25; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await seedGravacao({
        ownerUsername: "servidor1",
        numeroProcesso: `PAGE-${String(i).padStart(3, "0")}`,
      });
    }
    await gotoConsulta(page);
    await expect(page.getByText(/Página 1 de 2/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Próximo/i }).click();
    await expect(page.getByText(/Página 2 de 2/i)).toBeVisible();
  });
});
