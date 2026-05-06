import { test, expect } from "./support/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("Autenticação", () => {
  test("SERVIDOR autenticado é direcionado ao painel do servidor", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/servidor1.json" });
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Painel do Servidor/i })).toBeVisible();
    await ctx.close();
  });

  test("JUIZ autenticado é direcionado ao painel do juiz", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/juiz1.json" });
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Painel do Juiz/i })).toBeVisible();
    // O CTA "Iniciar Audiência" do conteúdo do dashboard só aparece para SERVIDOR
    await expect(page.getByRole("link", { name: /Iniciar Audiência/i })).toHaveCount(0);
    await ctx.close();
  });

  test("API rejeita credenciais inválidas", async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL });
    const csrfRes = await api.get("/api/auth/csrf");
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const res = await api.post("/api/auth/callback/credentials", {
      form: {
        csrfToken,
        username: "servidor1",
        password: "senha-errada",
        callbackUrl: `${baseURL}/dashboard`,
        json: "true",
      },
      maxRedirects: 0,
    });
    const body = (await res.json()) as { url?: string };
    expect(body.url ?? "").toContain("error=CredentialsSignin");
    const sessionRes = await api.get("/api/auth/session");
    const session = (await sessionRes.json()) as { user?: unknown };
    expect(session.user).toBeUndefined();
    await api.dispose();
  });

  test("API aceita credenciais válidas e popula sessão", async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL });
    const csrfRes = await api.get("/api/auth/csrf");
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const res = await api.post("/api/auth/callback/credentials", {
      form: {
        csrfToken,
        username: "servidor1",
        password: "senha123",
        callbackUrl: `${baseURL}/dashboard`,
        json: "true",
      },
      maxRedirects: 0,
    });
    expect(res.status()).toBeLessThan(400);
    const sessionRes = await api.get("/api/auth/session");
    const session = (await sessionRes.json()) as { user?: { username?: string; role?: string } };
    expect(session.user?.username).toBe("servidor1");
    expect(session.user?.role).toBe("SERVIDOR");
    await api.dispose();
  });

  test("acesso anônimo a rota protegida redireciona para /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/consulta");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/gravacao/nova");
    await expect(page).toHaveURL(/\/login/);
  });

  test("logout limpa a sessão", async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: "e2e/.auth/servidor1.json",
      baseURL,
    });
    const before = await api.get("/api/auth/session");
    expect(((await before.json()) as { user?: unknown }).user).toBeDefined();

    const csrfRes = await api.get("/api/auth/csrf");
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    await api.post("/api/auth/signout", {
      form: { csrfToken, callbackUrl: `${baseURL}/login`, json: "true" },
      maxRedirects: 0,
    });

    const after = await api.get("/api/auth/session");
    const afterBody = (await after.json()) as { user?: unknown };
    expect(afterBody.user).toBeUndefined();
    await api.dispose();
  });
});
