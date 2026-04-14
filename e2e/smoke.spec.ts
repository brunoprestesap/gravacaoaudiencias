import { test, expect } from "@playwright/test";

test("página de login exibe título e formulário", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: /Gravação de Audiências/i })
  ).toBeVisible();
  await expect(page.getByLabel(/Usuário/i)).toBeVisible();
  await expect(page.getByLabel(/Senha/i)).toBeVisible();
});

test("área autenticada redireciona anônimos para login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
