import { describe, expect, it } from "vitest";
import { renderTermoDocx, renderTermoPdf } from "./render";

const sampleMarkdown = `# TERMO DE AUDIÊNCIA

**Processo:** 1004354-87.2026.4.01.3100

Às 09h do dia 05/05/2026, na sala de audiências do Juizado Especial Itinerante, presente o MM. Juiz Federal JUCÉLIO FLEURY NETO, foi aberta a Audiência.

## DISPOSITIVO

Ante o exposto:

- a) extingo o feito sem resolução do mérito
- b) defiro a justiça gratuita
- c) sem custas e honorários

**JUCÉLIO FLEURY NETO**
Juiz Federal`;

const header = {
  numeroProcesso: "1004354-87.2026.4.01.3100",
  partes: "Maria vs INSS",
  vara: "JEF Itinerante",
  classeProcessual: "Procedimento Comum",
  tipoAudiencia: "Conciliação, Instrução e Julgamento",
};

describe("renderTermoPdf", () => {
  it("retorna um Buffer com magic bytes de PDF", async () => {
    const buffer = await renderTermoPdf(sampleMarkdown, header);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    // PDFs começam com "%PDF-"
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("não falha em markdown vazio", async () => {
    const buffer = await renderTermoPdf("", header);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(100);
  });
});

describe("renderTermoDocx", () => {
  it("retorna um Buffer com magic bytes de ZIP (DOCX é zip)", async () => {
    const buffer = await renderTermoDocx(sampleMarkdown, header);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    // ZIP começa com "PK\x03\x04"
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });

  it("não falha em markdown vazio", async () => {
    const buffer = await renderTermoDocx("", header);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(100);
  });
});
