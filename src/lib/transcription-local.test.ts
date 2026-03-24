import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

const execFileMock = vi.fn();
const accessMock = vi.fn();
const mkdtempMock = vi.fn();
const readFileMock = vi.fn();
const rmMock = vi.fn();

vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock("fs/promises", () => ({
  access: (...args: unknown[]) => accessMock(...args),
  mkdtemp: (...args: unknown[]) => mkdtempMock(...args),
  readFile: (...args: unknown[]) => readFileMock(...args),
  rm: (...args: unknown[]) => rmMock(...args),
}));

import {
  LocalTranscriptionError,
  transcribeLocalRecording,
  validateLocalTranscriptionRuntime,
} from "./transcription-local";

describe("transcription-local", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHISPER_CPP_BIN = "/usr/local/bin/whisper-cli";
    process.env.WHISPER_MODEL_PATH = "/models/ggml-base.bin";

    accessMock.mockResolvedValue(undefined);
    mkdtempMock.mockResolvedValue("/tmp/audiencia-transcricao-123");
    readFileMock.mockResolvedValue("texto transcrito");
    rmMock.mockResolvedValue(undefined);
    execFileMock.mockImplementation(
      (_command: string, _args: string[], _options: unknown, callback: Mock) => {
        callback(null, "", "");
      }
    );
  });

  it("valida runtime local quando binários e modelo existem", async () => {
    await validateLocalTranscriptionRuntime();
    expect(accessMock).toHaveBeenCalledWith("/models/ggml-base.bin");
    expect(execFileMock).toHaveBeenCalled();
  });

  it("falha quando configuração obrigatória está ausente", async () => {
    delete process.env.WHISPER_CPP_BIN;
    await expect(validateLocalTranscriptionRuntime()).rejects.toMatchObject({
      code: "CONFIG_MISSING",
    });
  });

  it("transcreve gravação e retorna texto", async () => {
    const result = await transcribeLocalRecording({
      inputVideoPath: "/uploads/gravacao.mp4",
    });

    expect(result.text).toBe("texto transcrito");
    expect(readFileMock).toHaveBeenCalledWith(
      "/tmp/audiencia-transcricao-123/transcricao.txt",
      "utf-8"
    );
    expect(rmMock).toHaveBeenCalledWith("/tmp/audiencia-transcricao-123", {
      recursive: true,
      force: true,
    });
  });

  it("retorna erro quando texto da transcrição vem vazio", async () => {
    readFileMock.mockResolvedValue("   ");

    await expect(
      transcribeLocalRecording({
        inputVideoPath: "/uploads/gravacao.mp4",
      })
    ).rejects.toBeInstanceOf(LocalTranscriptionError);
  });

  it("retorna erro quando arquivo de entrada não existe", async () => {
    accessMock.mockRejectedValueOnce(new Error("not found"));

    await expect(
      transcribeLocalRecording({
        inputVideoPath: "/uploads/gravacao.mp4",
      })
    ).rejects.toMatchObject({ code: "INPUT_NOT_FOUND" });
  });
});
