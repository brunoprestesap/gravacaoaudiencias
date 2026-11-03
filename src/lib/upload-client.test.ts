import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureGravacaoRecord, uploadRecoverySegments } from "./upload-client";

const metadata = { numeroProcesso: "0001234-56.2026.4.01.3400", vara: "3ª Vara Federal" };

describe("ensureGravacaoRecord", () => {
  const fetchMock = vi.fn();
  const respond = (status: number) => new Response("{}", { status });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("não cria nada quando o registro já existe", async () => {
    fetchMock.mockResolvedValueOnce(respond(200));

    await ensureGravacaoRecord("g1", metadata, "PRESENCIAL");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/gravacoes/g1");
  });

  it("cria o registro com o mesmo id e os dados locais quando ele não existe", async () => {
    fetchMock.mockResolvedValueOnce(respond(404)).mockResolvedValueOnce(respond(200));

    await ensureGravacaoRecord("g1", metadata, "HIBRIDO");

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/gravacoes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ id: "g1", metadata, modo: "HIBRIDO" });
  });

  it.each([401, 403, 500])("não tenta criar quando a consulta responde %i", async (status) => {
    fetchMock.mockResolvedValueOnce(respond(status));

    await expect(ensureGravacaoRecord("g1", metadata, "PRESENCIAL")).rejects.toThrow(String(status));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falha quando a criação é recusada, para o upload não seguir", async () => {
    fetchMock.mockResolvedValueOnce(respond(404)).mockResolvedValueOnce(respond(500));

    await expect(ensureGravacaoRecord("g1", metadata, "PRESENCIAL")).rejects.toThrow("500");
  });

  it("não cria registro com o número provisório da tela de retomada", async () => {
    fetchMock.mockResolvedValueOnce(respond(404));

    await expect(
      ensureGravacaoRecord("g1", { numeroProcesso: "(Recuperando dados...)" }, "PRESENCIAL")
    ).rejects.toThrow("indisponíveis");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propaga falha de rede", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(ensureGravacaoRecord("g1", metadata, "PRESENCIAL")).rejects.toThrow("Failed to fetch");
  });
});

describe("uploadRecoverySegments com WebM guardado no servidor", () => {
  const fetchMock = vi.fn();
  const xhrSend = vi.fn();
  const segment = new Blob(["12345"], { type: "video/webm" });

  class FakeXhr {
    upload = { addEventListener: vi.fn() };
    status = 200;
    responseText = JSON.stringify({ success: true, filePath: "enviado.mp4", fileSize: 1 });
    private listeners: Record<string, () => void> = {};
    addEventListener(name: string, fn: () => void) {
      this.listeners[name] = fn;
    }
    open() {}
    send(body: FormData) {
      xhrSend(body);
      this.listeners.load();
    }
  }

  beforeEach(() => {
    fetchMock.mockReset();
    xhrSend.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("não envia os segmentos quando a conversão do WebM guardado dá certo", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, filePath: "guardado.mp4", fileSize: 1 }))
    );

    const result = await uploadRecoverySegments("g1", [segment, segment], { duracao: 10 });

    expect(result.filePath).toBe("guardado.mp4");
    expect(xhrSend).not.toHaveBeenCalled();
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("mode")).toBe("retryConversion");
    expect(body.get("inputBytes")).toBe("10");
  });

  it("envia os segmentos quando não há nada guardado para esse tamanho", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));

    const result = await uploadRecoverySegments("g1", [segment]);

    expect(result.filePath).toBe("enviado.mp4");
    expect(xhrSend).toHaveBeenCalledTimes(1);
  });

  it("não reenvia quando a conversão do WebM guardado falha de novo", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));

    await expect(uploadRecoverySegments("g1", [segment])).rejects.toThrow();
    expect(xhrSend).not.toHaveBeenCalled();
  });
});
