import { rmSync } from "fs";
import { mkdir, readdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { uploadDir, transcodeMock, updateMock, gravacao } = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/audiencia-upload-falha-${process.pid}`;
  process.env.UPLOAD_DIR = dir;
  return {
    uploadDir: dir,
    transcodeMock: vi.fn(),
    updateMock: vi.fn(),
    gravacao: { caminhoArquivo: null as string | null },
  };
});

vi.mock("@/lib/api-auth", () => ({
  getSessionOrError: async () => ({
    session: { user: { id: "user-1", role: "SERVIDOR", vara: null } },
    error: null,
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gravacao: {
      findUnique: async () => ({
        id: "grav1",
        userId: "user-1",
        vara: "1 Vara",
        numeroProcesso: "0001234-56.2026.4.01.3400",
        caminhoArquivo: gravacao.caminhoArquivo,
      }),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

vi.mock("@/lib/upload-ffmpeg", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-ffmpeg")>()),
  assertRecordingIntegrity: async () => ({ ok: true, reason: "OK", durationSeconds: 2 }),
  extractTranscriptionAudio: async (_input: string, output: string) => {
    await writeFile(output, "wav");
  },
  transcodeWebmToMp4Adaptive: (...args: unknown[]) => transcodeMock(...args),
}));

import { POST } from "./route";
import { restoreInterruptedConversions } from "@/lib/conversao-pendente";

const CONTEUDO = "conteudo-do-webm";

async function arquivos(dir = uploadDir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map((e) =>
      e.isDirectory() ? arquivos(path.join(dir, e.name)) : [path.join(dir, e.name)]
    )
  );
  return nested.flat();
}

function enviar() {
  const formData = new FormData();
  formData.append("gravacaoId", "grav1");
  formData.append("duracao", "2");
  formData.append("file", new File([CONTEUDO], "a.webm", { type: "video/webm" }));
  return POST({ formData: async () => formData } as never);
}

function tentarDeNovo(inputBytes: number) {
  const formData = new FormData();
  formData.append("mode", "retryConversion");
  formData.append("gravacaoId", "grav1");
  formData.append("inputBytes", String(inputBytes));
  return POST({ formData: async () => formData } as never);
}

function transcodeOk() {
  transcodeMock.mockImplementationOnce(async (_input: string, output: string) => {
    await writeFile(output, "mp4");
    return {
      fileSize: 3,
      durationSeconds: 2,
      exceededPjeLimit: false,
      warning: null,
      diagnostics: null,
      timings: null,
    };
  });
}

function transcodeFalha() {
  transcodeMock.mockImplementationOnce(async (_input: string, output: string) => {
    await writeFile(output, "mp4 pela metade");
    throw new Error("ffmpeg falhou");
  });
}

describe("POST /api/upload quando a conversão falha", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    rmSync(uploadDir, { recursive: true, force: true });
    await mkdir(uploadDir, { recursive: true });
    gravacao.caminhoArquivo = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => rmSync(uploadDir, { recursive: true, force: true }));

  it("mantém o WebM no servidor", async () => {
    transcodeFalha();

    const res = await enviar();

    expect(res.status).toBe(500);
    const webms = (await arquivos()).filter((f) => f.endsWith(".webm"));
    expect(webms).toHaveLength(1);
    expect(await readFile(webms[0], "utf-8")).toBe(CONTEUDO);
  });

  it("apaga o WebM quando a conversão dá certo", async () => {
    transcodeOk();

    const res = await enviar();

    expect(res.status).toBe(200);
    expect((await arquivos()).filter((f) => f.endsWith(".webm"))).toEqual([]);
  });

  it("não deixa MP4 pela metade nem WAV sem registro", async () => {
    transcodeFalha();

    await enviar();

    const sobras = (await arquivos()).filter((f) => !f.endsWith(".webm"));
    expect(sobras).toEqual([]);
  });

  it("não apaga o MP4 de um envio anterior que deu certo no mesmo dia", async () => {
    transcodeOk();
    const primeiro = await (await enviar()).json();
    gravacao.caminhoArquivo = primeiro.filePath;
    transcodeMock.mockRejectedValueOnce(new Error("FFMPEG_NOT_AVAILABLE"));

    await enviar();

    const mp4 = path.join(uploadDir, primeiro.filePath);
    expect(await readFile(mp4, "utf-8")).toBe("mp4");
  });

  it("tenta de novo sem novo envio e, se der certo, apaga o WebM guardado", async () => {
    transcodeFalha();
    await enviar();
    transcodeOk();

    const res = await tentarDeNovo(CONTEUDO.length);

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const restantes = await arquivos();
    expect(restantes.filter((f) => f.endsWith(".webm"))).toEqual([]);
    expect(restantes.filter((f) => f.endsWith(".mp4"))).toHaveLength(1);
  });

  it("converte de novo exatamente o conteúdo guardado", async () => {
    transcodeFalha();
    await enviar();
    let lido = "";
    transcodeMock.mockImplementationOnce(async (input: string) => {
      lido = await readFile(input, "utf-8");
      throw new Error("ffmpeg falhou de novo");
    });

    await tentarDeNovo(CONTEUDO.length);

    expect(lido).toBe(CONTEUDO);
  });

  it("mantém o WebM guardado quando a nova tentativa também falha", async () => {
    transcodeFalha();
    await enviar();
    transcodeFalha();

    const res = await tentarDeNovo(CONTEUDO.length);

    expect(res.status).toBe(500);
    expect((await arquivos()).filter((f) => f.endsWith(".webm"))).toHaveLength(1);
  });

  it("não usa o WebM guardado quando o tamanho é outro, como depois de retomar", async () => {
    transcodeFalha();
    await enviar();

    const res = await tentarDeNovo(CONTEUDO.length + 1000);

    expect(res.status).toBe(404);
    expect(transcodeMock).toHaveBeenCalledTimes(1);
  });

  it("responde 404 quando não há nada guardado", async () => {
    const res = await tentarDeNovo(CONTEUDO.length);

    expect(res.status).toBe(404);
  });

  it("recusa tamanho inválido na nova tentativa", async () => {
    const res = await tentarDeNovo(Number.NaN);

    expect(res.status).toBe(400);
  });

  it("um novo envio que dá certo apaga o WebM guardado de um envio menor", async () => {
    transcodeFalha();
    await enviar();
    transcodeOk();
    const formData = new FormData();
    formData.append("gravacaoId", "grav1");
    formData.append("file", new File([`${CONTEUDO}+trecho novo`], "a.webm", { type: "video/webm" }));

    const res = await POST({ formData: async () => formData } as never);

    expect(res.status).toBe(200);
    expect((await arquivos()).filter((f) => f.endsWith(".webm"))).toEqual([]);
  });

  it("duas tentativas simultâneas fazem uma única conversão", async () => {
    transcodeFalha();
    await enviar();
    let terminar = () => {};
    transcodeMock.mockImplementationOnce(async (_input: string, output: string) => {
      await new Promise<void>((resolve) => (terminar = resolve));
      await writeFile(output, "mp4");
      return {
        fileSize: 3,
        durationSeconds: 2,
        exceededPjeLimit: false,
        warning: null,
        diagnostics: null,
        timings: null,
      };
    });

    const primeira = tentarDeNovo(CONTEUDO.length);
    await vi.waitFor(() => expect(transcodeMock).toHaveBeenCalledTimes(2));
    const segunda = await tentarDeNovo(CONTEUDO.length);

    expect(segunda.status).toBe(409);
    terminar();
    expect((await primeira).status).toBe(200);
    expect(transcodeMock).toHaveBeenCalledTimes(2);
    expect((await arquivos()).filter((f) => f.endsWith(".mp4"))).toHaveLength(1);
  });

  it("depois que a nova tentativa falha, a seguinte pede o envio completo e o WebM continua", async () => {
    transcodeFalha();
    await enviar();
    transcodeFalha();
    await tentarDeNovo(CONTEUDO.length);

    const res = await tentarDeNovo(CONTEUDO.length);

    expect(res.status).toBe(404);
    expect(transcodeMock).toHaveBeenCalledTimes(2);
    expect((await arquivos()).filter((f) => f.endsWith(".webm"))).toHaveLength(1);
  });

  it("um envio completo que falha substitui o WebM já tentado", async () => {
    transcodeFalha();
    await enviar();
    transcodeFalha();
    await tentarDeNovo(CONTEUDO.length);
    transcodeFalha();
    await enviar();
    transcodeOk();

    const res = await tentarDeNovo(CONTEUDO.length);

    expect(res.status).toBe(200);
    expect((await arquivos()).filter((f) => f.endsWith(".webm"))).toEqual([]);
  });

  it("uma queda do servidor no meio da conversão devolve o WebM reservado", async () => {
    transcodeFalha();
    await enviar();
    const [guardado] = (await arquivos()).filter((f) => f.endsWith(".webm"));
    await rename(guardado, guardado.replace(/\.webm$/, ".convertendo.webm"));
    expect((await tentarDeNovo(CONTEUDO.length)).status).toBe(409);

    expect(await restoreInterruptedConversions()).toBe(1);

    transcodeOk();
    expect((await tentarDeNovo(CONTEUDO.length)).status).toBe(200);
  });

  it("uma falha ao guardar o WebM não esconde o erro da conversão", async () => {
    await writeFile(path.join(uploadDir, "conversoes-pendentes"), "ocupa o nome da pasta");
    transcodeFalha();

    const res = await enviar();

    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Falha ao converter");
    expect((await arquivos()).filter((f) => f.endsWith(".webm"))).toHaveLength(1);
  });

  it("mantém o WebM quando o banco falha depois da conversão", async () => {
    transcodeOk();
    updateMock.mockRejectedValueOnce(new Error("banco fora do ar"));

    const res = await enviar();

    expect(res.status).toBe(500);
    expect((await arquivos()).filter((f) => f.endsWith(".webm"))).toHaveLength(1);
  });
});
