import { test, expect } from "./support/test";

test.describe("Dashboard", () => {
  test("SERVIDOR vê CTA Nova Gravação e nome", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/servidor1.json" });
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Painel do Servidor/i })).toBeVisible();
    await expect(page.getByText(/Maria Silva/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Iniciar Audiência/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Consultar Acervo/i })).toBeVisible();
    await ctx.close();
  });

  test("JUIZ não vê CTAs de gravação", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/juiz1.json" });
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Painel do Juiz/i })).toBeVisible();
    await expect(page.getByText(/Carlos Oliveira/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Iniciar Audiência/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Buscar Gravações/i })).toBeVisible();
    await ctx.close();
  });
});
