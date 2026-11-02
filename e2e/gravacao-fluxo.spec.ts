import type { Page, Route } from "@playwright/test";
import { test, expect } from "./support/test";
import { getPrisma } from "./fixtures/db";
import { confirmStop, randomProcesso, startRecordingFromWizard } from "./fixtures/recording";

const expectFinalized = async (numeroProcesso: string) => {
  const row = await getPrisma().gravacao.findFirst({ where: { numeroProcesso } });
  expect(row?.status).toBe("FINALIZADA");
  expect(row?.caminhoArquivo).toMatch(/\.mp4$/);
  expect(row?.vara).toBe("3ª Vara Federal");
};

// Simula uma queda do navegador no meio da audiência e volta ao painel.
const crashAndOpenDashboard = async (page: Page) => {
  await page.waitForTimeout(6_000);
  await page.goto("/dashboard");
  await expect(page.getByText("Gravação interrompida detectada")).toBeVisible({ timeout: 15_000 });
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

        await startRecordingFromWizard(page, numeroProcesso);
        await page.waitForTimeout(6_000);
        await confirmStop(page);

        await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
        await expectFinalized(numeroProcesso);
      } finally {
        await getPrisma().gravacao.deleteMany({ where: { numeroProcesso } });
      }
    });
  }

  test("retoma após queda, avisa da falha no envio e permite tentar de novo", async ({ page }) => {
    test.setTimeout(120_000);
    const numeroProcesso = randomProcesso();

    try {
      await startRecordingFromWizard(page, numeroProcesso);
      await crashAndOpenDashboard(page);

      await page.getByRole("button", { name: "Retomar Gravação" }).click();
      await expect(page).toHaveURL(/\/gravacao\/grav-/);
      await expect(page.getByText(numeroProcesso).first()).toBeVisible();
      await page.getByTitle("Iniciar Gravação").click();
      await expect(page.getByTitle("Encerrar")).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(6_000);

      await page.route("**/api/upload", (route) => route.abort("failed"), { times: 1 });
      await confirmStop(page);
      await expect(page.getByText(/Falha ao enviar gravação ao servidor/)).toBeVisible({
        timeout: 15_000,
      });

      await confirmStop(page);
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
      await expectFinalized(numeroProcesso);
    } finally {
      await getPrisma().gravacao.deleteMany({ where: { numeroProcesso } });
    }
  });

  test("finaliza pelo banner uma gravação sem registro no servidor", async ({ page }) => {
    test.setTimeout(120_000);
    const numeroProcesso = randomProcesso();

    try {
      await page.route("**/api/gravacoes", (route) => route.abort("failed"), { times: 1 });
      await startRecordingFromWizard(page, numeroProcesso);
      await crashAndOpenDashboard(page);

      await page.getByRole("button", { name: "Finalizar com Chunks Disponíveis" }).click();

      await expect(page.getByText("Gravação interrompida detectada")).toHaveCount(0, {
        timeout: 60_000,
      });
      await expectFinalized(numeroProcesso);
    } finally {
      await getPrisma().gravacao.deleteMany({ where: { numeroProcesso } });
    }
  });
});
