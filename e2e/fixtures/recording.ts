import type { Page } from "@playwright/test";
import { expect } from "../support/test";

export const randomProcesso = () => {
  const d = Array.from({ length: 20 }, () => Math.floor(Math.random() * 10)).join("");
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
};

export const startRecordingFromWizard = async (page: Page, numeroProcesso: string) => {
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
};

export const confirmStop = async (page: Page) => {
  await page.getByTitle("Encerrar").click();
  await page.getByRole("button", { name: "Encerrar", exact: true }).last().click();
};
