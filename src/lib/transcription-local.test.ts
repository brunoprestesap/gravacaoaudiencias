import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

const execFileMock = vi.fn();
const accessMock = vi.fn();
const mkdtempMock = vi.fn();
const readFileMock = vi.fn();
const rmMock = vi.fn();
const transcribeWithGoogleMock = vi.fn();

vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock("fs/promises", () => ({
  access: (...args: unknown[]) => accessMock(...args),
  mkdtemp: (...args: unknown[]) => mkdtempMock(...args),
  readFile: (...args: unknown[]) => readFileMock(...args),
  rm: (...args: unknown[]) => rmMock(...args),
}));

vi.mock("./transcription-local/google", () => ({
  transcribeNormalizedWavWithGoogle: (...args: unknown[]) => transcribeWithGoogleMock(...args),
}));

const bucketGetFilesMock = vi.fn();
const storageBucketMock = vi.fn(() => ({ getFiles: bucketGetFilesMock }));

vi.mock("./transcription-local/google/client", async () => {
  const errors = await import("./transcription-local/errors");
  return {
    createStorageClient: () => ({ bucket: storageBucketMock }),
    getGoogleTranscriptionConfig: () => {
      const bucketName = process.env.GCS_TRANSCRIPTION_BUCKET?.trim();
      if (!bucketName) {
        throw new errors.LocalTranscriptionError(
          "GCS_BUCKET_NOT_CONFIGURED",
          "GCS_TRANSCRIPTION_BUCKET não está configurado para o motor google."
        );
      }
      return {
        region: process.env.GOOGLE_TRANSCRIPTION_REGION?.trim() || "us-central1",
        model: process.env.GOOGLE_TRANSCRIPTION_MODEL?.trim() || "chirp_2",
        language: process.env.GOOGLE_TRANSCRIPTION_LANGUAGE?.trim() || "pt-BR",
        bucketName,
        diarizationEnabled: false,
        diarization: { minSpeakerCount: 2, maxSpeakerCount: 6 },
      };
    },
  };
});

import {
  LocalTranscriptionError,
  getLocalTranscriptionEngine,
  transcribeLocalRecording,
  validateLocalTranscriptionRuntime,
} from "./transcription-local";
import { parseWav2VecTranscriptionOutput } from "./transcription-local/wav2vec";
import {
  parseLegalWhisperTranscriptionOutput,
  segmentsFromLegalWhisperPayload,
} from "./transcription-local/legal-whisper";

describe("transcription-local", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOCAL_TRANSCRIPTION_ENGINE;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GCS_TRANSCRIPTION_BUCKET;
    process.env.WHISPER_CPP_BIN = "/usr/local/bin/whisper-cli";
    process.env.WHISPER_MODEL_PATH = "/models/ggml-base.bin";

    accessMock.mockResolvedValue(undefined);
    mkdtempMock.mockResolvedValue("/tmp/audiencia-transcricao-123");
    readFileMock.mockResolvedValue("texto transcrito");
    rmMock.mockResolvedValue(undefined);
    bucketGetFilesMock.mockResolvedValue([[], null]);
    transcribeWithGoogleMock.mockResolvedValue({
      text: "transcrição via google",
      baseSegments: [
        {
          id: "seg-1",
          text: "transcrição via google",
          offsetMs: 0,
          createdAt: "2026-05-04T12:00:00.000Z",
          startMs: 0,
          endMs: 1000,
          speakerId: "1",
        },
      ],
    });
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

    it("aceita legal-whisper", () => {
      process.env.LOCAL_TRANSCRIPTION_ENGINE = "legal-whisper";
      expect(getLocalTranscriptionEngine()).toBe("legal-whisper");
    });

    it("aceita google", () => {
      process.env.LOCAL_TRANSCRIPTION_ENGINE = "google";
      expect(getLocalTranscriptionEngine()).toBe("google");
    });

    it("aceita aliases para google (chirp, gcp)", () => {
      process.env.LOCAL_TRANSCRIPTION_ENGINE = "chirp";
      expect(getLocalTranscriptionEngine()).toBe("google");
      process.env.LOCAL_TRANSCRIPTION_ENGINE = "gcp";
      expect(getLocalTranscriptionEngine()).toBe("google");
    });
  });

  describe("motor whisper", () => {
    it("valida runtime local quando binários e modelo existem", async () => {
      await validateLocalTranscriptionRuntime();
      expect(accessMock).toHaveBeenCalledWith("/models/ggml-base.bin");
      expect(execFileMock).toHaveBeenCalled();
    });

    it("não passa --prompt quando WHISPER_INITIAL_PROMPT está vazio", async () => {
      delete process.env.WHISPER_INITIAL_PROMPT;
      await transcribeLocalRecording({ inputVideoPath: "/uploads/gravacao.mp4" });
      const whisperCall = execFileMock.mock.calls.find(
        (call) => String(call[0]).includes("whisper")
      );
      expect(whisperCall).toBeDefined();
      expect((whisperCall?.[1] as string[]).includes("--prompt")).toBe(false);
    });

    it("passa --suppress-nst e --max-context 0 por padrão", async () => {
      delete process.env.WHISPER_INITIAL_PROMPT;
      await transcribeLocalRecording({ inputVideoPath: "/uploads/gravacao.mp4" });
      const whisperCall = execFileMock.mock.calls.find(
        (call) => String(call[0]).includes("whisper")
      );
      const args = whisperCall?.[1] as string[];
      expect(args).toContain("--suppress-nst");
      expect(args).toContain("--max-context");
      const idx = args.indexOf("--max-context");
      expect(args[idx + 1]).toBe("0");
    });

    it("passa --prompt quando WHISPER_INITIAL_PROMPT está definido", async () => {
      process.env.WHISPER_INITIAL_PROMPT = "Audiência judicial. Magistrado.";
      await transcribeLocalRecording({ inputVideoPath: "/uploads/gravacao.mp4" });
      const whisperCall = execFileMock.mock.calls.find(
        (call) => String(call[0]).includes("whisper")
      );
      expect(whisperCall).toBeDefined();
      const args = whisperCall?.[1] as string[];
      const idx = args.indexOf("--prompt");
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe("Audiência judicial. Magistrado.");
      delete process.env.WHISPER_INITIAL_PROMPT;
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

  describe("parseLegalWhisperTranscriptionOutput", () => {
    it("interpreta JSON válido", () => {
      expect(
        parseLegalWhisperTranscriptionOutput(
          '{"text":"abertura","segments":[{"text":"abertura","startMs":0,"endMs":1000,"offsetMs":0}]}'
        )
      ).toEqual({
        text: "abertura",
        segments: [{ text: "abertura", startMs: 0, endMs: 1000, offsetMs: 0 }],
      });
    });

    it("lança TRANSCRIPTION_FAILED em JSON inválido", () => {
      let err: unknown;
      try {
        parseLegalWhisperTranscriptionOutput("not-json{");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(LocalTranscriptionError);
      expect(err).toMatchObject({ code: "TRANSCRIPTION_FAILED" });
    });
  });

  describe("segmentsFromLegalWhisperPayload", () => {
    it("retorna null quando segments ausente ou vazio", () => {
      expect(segmentsFromLegalWhisperPayload({})).toBeNull();
      expect(segmentsFromLegalWhisperPayload({ segments: [] })).toBeNull();
    });

    it("ignora segmentos com texto vazio e preserva timestamps", () => {
      const out = segmentsFromLegalWhisperPayload({
        segments: [
          { text: "", startMs: 0, endMs: 1000 },
          { text: "Aberta a audiência", startMs: 1000, endMs: 4000, offsetMs: 1000 },
        ],
      });
      expect(out).not.toBeNull();
      expect(out).toHaveLength(1);
      expect(out?.[0]).toMatchObject({
        text: "Aberta a audiência",
        startMs: 1000,
        endMs: 4000,
        offsetMs: 1000,
      });
    });

    it("derruba timestamps ausentes para offsetMs ou índice * 30s", () => {
      const out = segmentsFromLegalWhisperPayload({
        segments: [
          { text: "primeiro" },
          { text: "segundo", offsetMs: 30000 },
        ],
      });
      expect(out).not.toBeNull();
      expect(out?.[0].startMs).toBe(0);
      expect(out?.[0].offsetMs).toBe(0);
      expect(out?.[1].startMs).toBe(30000);
      expect(out?.[1].offsetMs).toBe(30000);
    });
  });

  describe("motor legal-whisper", () => {
    beforeEach(() => {
      process.env.LOCAL_TRANSCRIPTION_ENGINE = "legal-whisper";
      readFileMock.mockResolvedValue(
        JSON.stringify({
          text: "ABERTA A AUDIÊNCIA",
          segments: [
            { text: "ABERTA A AUDIÊNCIA", startMs: 0, endMs: 30000, offsetMs: 0 },
          ],
        })
      );
    });

    it("valida runtime quando ffmpeg e python --check funcionam", async () => {
      await validateLocalTranscriptionRuntime();
      const pythonCheck = execFileMock.mock.calls.find(
        (call) =>
          Array.isArray(call[1]) &&
          (call[1] as string[]).includes("--check") &&
          (call[1] as string[]).some((a) => String(a).includes("transcribe_legal_whisper.py"))
      );
      expect(pythonCheck).toBeDefined();
    });

    it("falha com CONFIG_MISSING quando o script Python não existe", async () => {
      accessMock.mockImplementation((target: string) => {
        if (String(target).includes("transcribe_legal_whisper.py")) {
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

      expect(result.text).toBe("ABERTA A AUDIÊNCIA");
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

    it("propaga LEGAL_WHISPER_MODEL_ID padrão para o processo Python", async () => {
      delete process.env.LEGAL_WHISPER_MODEL_ID;
      delete process.env.LEGAL_WHISPER_BASE_MODEL_ID;

      await transcribeLocalRecording({
        inputVideoPath: "/uploads/gravacao.mp4",
      });

      const transcribeCall = execFileMock.mock.calls.find(
        (call) =>
          Array.isArray(call[1]) &&
          (call[1] as string[]).some((a) => String(a).includes("transcribe_legal_whisper.py")) &&
          !(call[1] as string[]).includes("--check")
      );

      expect(transcribeCall).toBeDefined();
      const opts = transcribeCall?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
      expect(opts?.env?.LEGAL_WHISPER_MODEL_ID).toBe(
        "rhaymison/transcription-portuguese-legal-whisper-peft"
      );
      expect(opts?.env?.LEGAL_WHISPER_BASE_MODEL_ID).toBe("openai/whisper-large-v3");
    });
  });

  describe("motor google", () => {
    beforeEach(() => {
      process.env.LOCAL_TRANSCRIPTION_ENGINE = "google";
      process.env.GOOGLE_APPLICATION_CREDENTIALS = "/secrets/sa.json";
      process.env.GCS_TRANSCRIPTION_BUCKET = "audiencia-transcricoes";
    });

    it("valida runtime quando credenciais e bucket existem", async () => {
      await validateLocalTranscriptionRuntime();
      expect(accessMock).toHaveBeenCalledWith("/secrets/sa.json");
      expect(storageBucketMock).toHaveBeenCalledWith("audiencia-transcricoes");
      expect(bucketGetFilesMock).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 1, autoPaginate: false })
      );
    });

    it("falha com GOOGLE_CREDENTIALS_NOT_FOUND quando GOOGLE_APPLICATION_CREDENTIALS ausente", async () => {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      await expect(validateLocalTranscriptionRuntime()).rejects.toMatchObject({
        code: "GOOGLE_CREDENTIALS_NOT_FOUND",
      });
    });

    it("falha com GOOGLE_CREDENTIALS_NOT_FOUND quando o JSON não existe", async () => {
      accessMock.mockImplementation((target: string) => {
        if (String(target) === "/secrets/sa.json") {
          return Promise.reject(new Error("ENOENT"));
        }
        return Promise.resolve(undefined);
      });
      await expect(validateLocalTranscriptionRuntime()).rejects.toMatchObject({
        code: "GOOGLE_CREDENTIALS_NOT_FOUND",
      });
    });

    it("falha com GCS_BUCKET_NOT_CONFIGURED quando bucket não está definido", async () => {
      delete process.env.GCS_TRANSCRIPTION_BUCKET;
      await expect(validateLocalTranscriptionRuntime()).rejects.toMatchObject({
        code: "GCS_BUCKET_NOT_CONFIGURED",
      });
    });

    it("falha com GCS_BUCKET_INACCESSIBLE quando getFiles rejeita (404/403)", async () => {
      bucketGetFilesMock.mockRejectedValue(new Error("Not Found"));
      await expect(validateLocalTranscriptionRuntime()).rejects.toMatchObject({
        code: "GCS_BUCKET_INACCESSIBLE",
      });
    });

    it("delega para transcribeNormalizedWavWithGoogle e devolve segmentos", async () => {
      const result = await transcribeLocalRecording({
        inputVideoPath: "/uploads/gravacao.mp4",
        metadata: { numeroProcesso: "1234567" },
      });

      expect(transcribeWithGoogleMock).toHaveBeenCalledWith(
        expect.stringContaining("audio.wav"),
        expect.objectContaining({ numeroProcesso: "1234567" })
      );
      expect(result.text).toBe("transcrição via google");
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].speakerId).toBe("1");
    });

    it("rejeita transcrição vazia do google", async () => {
      transcribeWithGoogleMock.mockResolvedValueOnce({ text: "", baseSegments: [] });
      await expect(
        transcribeLocalRecording({ inputVideoPath: "/uploads/gravacao.mp4" })
      ).rejects.toMatchObject({ code: "EMPTY_TRANSCRIPTION" });
    });

    it("propaga falhas do motor google como LocalTranscriptionError", async () => {
      transcribeWithGoogleMock.mockRejectedValueOnce(
        new LocalTranscriptionError("TRANSCRIPTION_FAILED", "boom")
      );
      await expect(
        transcribeLocalRecording({ inputVideoPath: "/uploads/gravacao.mp4" })
      ).rejects.toMatchObject({ code: "TRANSCRIPTION_FAILED" });
    });
  });

});
