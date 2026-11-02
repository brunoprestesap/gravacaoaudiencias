import type { Route } from "@playwright/test";
import { test, expect } from "./support/test";
import { getPrisma } from "./fixtures/db";

const randomProcesso = () => {
  const d = Array.from({ length: 20 }, () => Math.floor(Math.random() * 10)).join("");
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
};

type CreateFailure = (route: Route) => Promise<void>;

const scenarios: Array<[string, CreateFailure | null]> = [
  ["registro criado normalmente", null],
  ["rede falha ao criar o registro", (route) => route.abort("failed")],
  ["servidor responde 500 ao criar o registro", (route) => route.fulfill({ status: 500, body: "{}" })],
];

test.describe("Fluxo completo de gravação", () => {
  test.use({ storageState: "e2e/.auth/servidor1.json" });

  for (const [name, failure] of scenarios) {
    test(`grava e envia: ${name}`, async ({ page }) => {
      test.setTimeout(90_000);
      const numeroProcesso = randomProcesso();

      try {
        if (failure) {
          // Falha só a criação feita ao iniciar; a nova tentativa antes do upload passa.
          await page.route("**/api/gravacoes", failure, { times: 1 });
        }

        await page.goto("/gravacao/nova");
        await page.locator("#numeroProcesso").fill(numeroProcesso);
        await page.locator("#classeProcessual").selectOption("Ação Ordinária");
        await page.locator("#tipoAudiencia").selectOption("Instrução");
        await page.locator("#partes").fill("João Silva x União Federal");
        await page.locator("#vara").fill("3ª Vara Federal");
        await page.locator("#nomeJuiz").fill("Dr. Carlos Oliveira");
        await page.getByRole("button", { name: "Próximo" }).click();

        await page.getByRole("button", { name: "Iniciar Gravação" }).click();
        await page.getByTitle("Iniciar Gravação").click();
        await expect(page.getByTitle("Encerrar")).toBeVisible({ timeout: 15_000 });

        await page.waitForTimeout(6_000);
        await page.getByTitle("Encerrar").click();
        await page.getByRole("button", { name: "Encerrar", exact: true }).last().click();

        await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });

        const row = await getPrisma().gravacao.findFirst({ where: { numeroProcesso } });
        expect(row?.status).toBe("FINALIZADA");
        expect(row?.caminhoArquivo).toMatch(/\.mp4$/);
        expect(row?.vara).toBe("3ª Vara Federal");
      } finally {
        await getPrisma().gravacao.deleteMany({ where: { numeroProcesso } });
      }
    });
  }
});
