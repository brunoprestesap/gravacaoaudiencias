import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// UPLOAD_DIR é lido quando as rotas são importadas, por isso é definido antes.
const { sandbox, uploadDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync, mkdirSync } = require("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require("os");
  const sandbox: string = mkdtempSync(join(tmpdir(), "audiencia-traversal-"));
  const uploadDir: string = join(sandbox, "uploads");
  mkdirSync(uploadDir);
  process.env.UPLOAD_DIR = uploadDir;
  return { sandbox, uploadDir };
});

const getSessionOrErrorMock = vi.fn();
let row: Record<string, unknown> | null;

vi.mock("@/lib/api-auth", () => ({
  getSessionOrError: (...args: unknown[]) => getSessionOrErrorMock(...args),
}));

// Banco em memória: o que o PATCH grava é o que as outras rotas leem depois.
vi.mock("@/lib/db", () => ({
  prisma: {
    gravacao: {
      findUnique: async () => row,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        row = { ...row, ...data };
        return row;
      },
      delete: async () => row,
    },
  },
}));

import { DELETE, PATCH } from "./route";
import { GET as DOWNLOAD } from "./download/route";
import { GET as STREAM } from "./stream/route";

const SECRET = "SEGREDO=nao-deveria-sair-do-servidor";
const secretPath = path.join(sandbox, "segredo.env");
const traversal = path.relative(uploadDir, secretPath);
const context = { params: Promise.resolve({ id: "gravacao-1" }) };

const patchRequest = (body: unknown) => ({ json: async () => body }) as never;
const getRequest = () => ({ headers: new Headers() }) as never;

const attack = () =>
  PATCH(patchRequest({ status: "FINALIZADA", caminhoArquivo: traversal }), context);

describe("/api/gravacoes/[id]: caminhoArquivo não pode vir do cliente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeFileSync(secretPath, SECRET);
    getSessionOrErrorMock.mockResolvedValue({
      session: { user: { id: "user-1", role: "SERVIDOR", vara: null } },
      error: null,
    });
    row = {
      id: "gravacao-1",
      userId: "user-1",
      vara: null,
      numeroProcesso: "0001234-56.2026.4.01.3400",
      status: "EM_ANDAMENTO",
      caminhoArquivo: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
  });

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("PATCH ignora caminhoArquivo e mantém os demais campos", async () => {
    const res = await attack();

    expect(res.status).toBe(200);
    expect(row?.caminhoArquivo).toBeNull();
    expect(row?.status).toBe("FINALIZADA");
  });

  it.each([
    ["download", DOWNLOAD],
    ["stream", STREAM],
  ])("%s não entrega arquivo fora de UPLOAD_DIR", async (_name, handler) => {
    await attack();

    const res = await handler(getRequest(), context);
    const body = await res.text();

    expect(body).not.toContain(SECRET);
    expect(res.status).toBe(404);
  });

  it("DELETE não apaga arquivo fora de UPLOAD_DIR", async () => {
    await attack();

    const res = await DELETE(getRequest(), context);

    expect(res.status).toBe(200);
    expect(existsSync(secretPath)).toBe(true);
  });

  describe("registro já gravado no banco com caminho malicioso", () => {
    beforeEach(() => {
      row = { ...row, status: "FINALIZADA", caminhoArquivo: traversal };
    });

    it.each([
      ["download", DOWNLOAD],
      ["stream", STREAM],
    ])("%s responde 404 sem ler o arquivo", async (_name, handler) => {
      const res = await handler(getRequest(), context);
      const body = await res.text();

      expect(res.status).toBe(404);
      expect(body).not.toContain(SECRET);
    });

    it("DELETE remove o registro e preserva o arquivo", async () => {
      const res = await DELETE(getRequest(), context);

      expect(res.status).toBe(200);
      expect(existsSync(secretPath)).toBe(true);
    });
  });

  describe("arquivo legítimo dentro de UPLOAD_DIR", () => {
    const relative = path.join("2026", "11", "3-vara", "gravacao-1.mp4");
    const absolute = path.join(uploadDir, relative);
    const wav = absolute.replace(/\.mp4$/, ".transcricao.wav");

    beforeEach(() => {
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, "video");
      writeFileSync(wav, "audio");
      row = { ...row, status: "FINALIZADA", caminhoArquivo: relative };
    });

    it.each([
      ["download", DOWNLOAD],
      ["stream", STREAM],
    ])("%s continua entregando o vídeo", async (_name, handler) => {
      const res = await handler(getRequest(), context);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("video");
    });

    it("DELETE continua apagando o vídeo e o WAV", async () => {
      const res = await DELETE(getRequest(), context);

      expect(res.status).toBe(200);
      expect(existsSync(absolute)).toBe(false);
      expect(existsSync(wav)).toBe(false);
    });
  });
});
