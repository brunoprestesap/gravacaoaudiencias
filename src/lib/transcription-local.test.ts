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
  getLocalTranscriptionEngine,
  transcribeLocalRecording,
  validateLocalTranscriptionRuntime,
} from "./transcription-local";
import { parseWav2VecTranscriptionOutput } from "./transcription-local/wav2vec";

describe("transcription-local", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOCAL_TRANSCRIPTION_ENGINE;
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

  describe("getLocalTranscriptionEngine", () => {
    it("retorna whisper por padrão", () => {
      delete process.env.LOCAL_TRANSCRIPTION_ENGINE;
      expect(getLocalTranscriptionEngine()).toBe("whisper");
    });

    it("aceita wav2vec2", () => {
      process.env.LOCAL_TRANSCRIPTION_ENGINE = "wav2vec2";
      expect(getLocalTranscriptionEngine()).toBe("wav2vec2");
    });
  });

  describe("motor whisper", () => {
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

  describe("parseWav2VecTranscriptionOutput", () => {
    it("interpreta JSON válido", () => {
      expect(parseWav2VecTranscriptionOutput('{"text":"ok","segments":[]}')).toEqual({
        text: "ok",
        segments: [],
      });
    });

    it("lança TRANSCRIPTION_FAILED em JSON inválido", () => {
      let err: unknown;
      try {
        parseWav2VecTranscriptionOutput("not-json{");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(LocalTranscriptionError);
      expect(err).toMatchObject({ code: "TRANSCRIPTION_FAILED" });
    });
  });

  describe("motor wav2vec2", () => {
    beforeEach(() => {
      process.env.LOCAL_TRANSCRIPTION_ENGINE = "wav2vec2";
      readFileMock.mockResolvedValue(
        JSON.stringify({
          text: "TEXTO DO MODELO",
          segments: [{ text: "TEXTO", startMs: 0, endMs: 5000, offsetMs: 0 }],
        })
      );
    });

    it("valida runtime quando ffmpeg e python --check funcionam", async () => {
      await validateLocalTranscriptionRuntime();
      expect(execFileMock).toHaveBeenCalled();
      const pythonCheck = execFileMock.mock.calls.find(
        (call) => Array.isArray(call[1]) && (call[1] as string[]).includes("--check")
      );
      expect(pythonCheck).toBeDefined();
    });

    it("falha com CONFIG_MISSING quando o script Python não existe", async () => {
      accessMock.mockImplementation((target: string) => {
        if (String(target).includes("transcribe_wav2vec2.py")) {
          return Promise.reject(new Error("ENOENT"));
        }
        return Promise.resolve(undefined);
      });

      await expect(validateLocalTranscriptionRuntime()).rejects.toMatchObject({
        code: "CONFIG_MISSING",
      });
    });

    it("falha com PYTHON_NOT_AVAILABLE quando --check falha", async () => {
      execFileMock.mockImplementation(
        (_command: string, args: string[], _options: unknown, callback: Mock) => {
          if (Array.isArray(args) && args.includes("--check")) {
            callback(new Error("spawn failed"), "", "");
            return;
          }
          callback(null, "", "");
        }
      );

      await expect(validateLocalTranscriptionRuntime()).rejects.toMatchObject({
        code: "PYTHON_NOT_AVAILABLE",
      });
    });

    it("transcreve via JSON e retorna texto", async () => {
      const result = await transcribeLocalRecording({
        inputVideoPath: "/uploads/gravacao.mp4",
      });

      expect(result.text).toBe("TEXTO DO MODELO");
      expect(readFileMock).toHaveBeenCalledWith(
        "/tmp/audiencia-transcricao-123/transcricao.json",
        "utf-8"
      );
      expect(result.segments.length).toBeGreaterThan(0);
    });

    it("rejeita JSON inválido do motor", async () => {
      readFileMock.mockResolvedValue("not-json{");

      await expect(
        transcribeLocalRecording({
          inputVideoPath: "/uploads/gravacao.mp4",
        })
      ).rejects.toMatchObject({ code: "TRANSCRIPTION_FAILED" });
    });

    it("rejeita transcrição vazia", async () => {
      readFileMock.mockResolvedValue(JSON.stringify({ text: "   ", segments: [] }));

      await expect(
        transcribeLocalRecording({
          inputVideoPath: "/uploads/gravacao.mp4",
        })
      ).rejects.toMatchObject({ code: "EMPTY_TRANSCRIPTION" });
    });
  });
});
