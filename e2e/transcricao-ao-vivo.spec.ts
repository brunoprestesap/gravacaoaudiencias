import type { Page, Request } from "@playwright/test";
import { test, expect } from "./support/test";
import { getPrisma } from "./fixtures/db";
import { confirmStop, randomProcesso, startRecordingFromWizard } from "./fixtures/recording";

// A suite roda com a transcrição ao vivo desligada, que é o padrão. Para exercitar o outro
// modo: NEXT_PUBLIC_LIVE_TRANSCRIPTION_ENABLED=true npx playwright test e2e/transcricao-ao-vivo.spec.ts
const liveEnabled = process.env.NEXT_PUBLIC_LIVE_TRANSCRIPTION_ENABLED === "true";

const FALA = "Declaro aberta a audiência, com a palavra o doutor.";

/** Reconhecedor falso: o real depende do serviço do navegador, indisponível no Playwright. */
const installFakeRecognizer = (page: Page) =>
  page.addInitScript((fala) => {
    const stats = { starts: 0, stops: 0, running: 0 };
    (window as unknown as { __sr: typeof stats }).__sr = stats;
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((e: unknown) => void) | null = null;
      onerror = null;
      onend: (() => void) | null = null;
      private timer: ReturnType<typeof setInterval> | null = null;
      start() {
        stats.starts += 1;
        stats.running += 1;
        this.timer = setInterval(() => {
          this.onresult?.({
            resultIndex: 0,
            results: [{ isFinal: true, 0: { transcript: fala } }],
          });
        }, 1000);
      }
      stop() {
        stats.stops += 1;
        if (this.timer) {
          clearInterval(this.timer);
          this.timer = null;
          stats.running -= 1;
        }
        this.onend?.();
      }
    }
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      FakeRecognition;
  }, FALA);

const recognizerStats = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sr: { starts: number; running: number } }).__sr);

test.describe("Transcrição ao vivo", () => {
  test.use({ storageState: "e2e/.auth/servidor1.json" });

  test("desligada: não reconhece fala nem envia nada em tempo real", async ({ page }) => {
    test.skip(liveEnabled, "só com a transcrição ao vivo desligada");
    test.setTimeout(90_000);
    const numeroProcesso = randomProcesso();
    const patches: Request[] = [];
    page.on("request", (req) => {
      if (req.method() === "PATCH" && req.url().endsWith("/transcricao")) patches.push(req);
    });

    try {
      await installFakeRecognizer(page);
      await startRecordingFromWizard(page, numeroProcesso);
      await page.waitForTimeout(6_000);

      expect((await recognizerStats(page)).starts).toBe(0);
      await expect(page.getByText("Transcrição ao vivo")).toHaveCount(0);

      await confirmStop(page);
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });

      expect(patches).toHaveLength(0);
      const row = await getPrisma().gravacao.findFirst({ where: { numeroProcesso } });
      expect(row?.status).toBe("FINALIZADA");
      expect(row?.transcricaoStatus).toBe("PENDENTE");
    } finally {
      await getPrisma().gravacao.deleteMany({ where: { numeroProcesso } });
    }
  });

  test("ligada: mantém o reconhecimento e envia durante a gravação", async ({ page }) => {
    test.skip(!liveEnabled, "só com NEXT_PUBLIC_LIVE_TRANSCRIPTION_ENABLED=true");
    test.setTimeout(90_000);
    const numeroProcesso = randomProcesso();

    try {
      await installFakeRecognizer(page);
      await startRecordingFromWizard(page, numeroProcesso);
      await page.waitForTimeout(7_000);

      expect((await recognizerStats(page)).running).toBe(1);
      await expect(page.getByText(FALA).first()).toBeVisible();

      const parcial = await getPrisma().gravacao.findFirst({ where: { numeroProcesso } });
      expect(parcial?.transcricaoStatus).toBe("PROCESSANDO");
      expect(parcial?.transcricaoTexto).toContain(FALA);

      await confirmStop(page);
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });

      const row = await getPrisma().gravacao.findFirst({ where: { numeroProcesso } });
      expect(row?.transcricaoStatus).toBe("CONCLUIDA");
      const segmentos = row?.transcricaoSegmentos as Array<{ id: string; role: string }>;
      expect(segmentos.length).toBeGreaterThan(3);
      expect(new Set(segmentos.map((s) => s.id)).size).toBe(segmentos.length);
      expect(segmentos.every((s) => s.role === "JUIZ")).toBe(true);
    } finally {
      await getPrisma().gravacao.deleteMany({ where: { numeroProcesso } });
    }
  });
});
