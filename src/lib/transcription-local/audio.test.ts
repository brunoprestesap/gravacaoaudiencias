import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

const execFileMock = vi.fn();

vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

import { normalizeAudio } from "./audio";

const LOUDNORM_STDERR = `[Parsed_loudnorm_0 @ 0x]
{
  "input_i" : "-23.10",
  "input_tp" : "-3.50",
  "input_lra" : "9.50",
  "input_thresh" : "-33.20",
  "output_i" : "-16.05",
  "output_tp" : "-1.50",
  "output_lra" : "8.40",
  "output_thresh" : "-26.20",
  "normalization_type" : "dynamic",
  "target_offset" : "0.05"
}
`;

function mockSuccess(stderr = ""): Mock {
  return execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Mock) => {
      cb(null, "", stderr);
    }
  );
}

describe("normalizeAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRANSCRIPTION_AUDIO_PREPROCESS;
  });

  it("usa modo basic por padrão (Whisper recomenda áudio bruto)", async () => {
    mockSuccess();

    await normalizeAudio("/in.mp4", "/out.wav");

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args).not.toContain("-af");
    expect(args).toContain("pcm_s16le");
    expect(args).toContain("16000");
    expect(args[args.length - 1]).toBe("/out.wav");
  });

  it("modo loudness aplica two-pass loudnorm SEM filtros espectrais", async () => {
    process.env.TRANSCRIPTION_AUDIO_PREPROCESS = "loudness";
    let calls = 0;
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Mock) => {
        calls += 1;
        cb(null, "", calls === 1 ? LOUDNORM_STDERR : "");
      }
    );

    await normalizeAudio("/in.mp4", "/out.wav");

    expect(execFileMock).toHaveBeenCalledTimes(2);
    const pass2Args = execFileMock.mock.calls[1][1] as string[];
    const filterChain = pass2Args[pass2Args.indexOf("-af") + 1];
    expect(filterChain).toContain("loudnorm=I=-16:TP=-1.5:LRA=11:linear=true");
    expect(filterChain).toContain("measured_I=-23.10");
    expect(filterChain).not.toContain("highpass");
    expect(filterChain).not.toContain("lowpass");
  });

  it("modo full inclui highpass + lowpass além do loudnorm", async () => {
    process.env.TRANSCRIPTION_AUDIO_PREPROCESS = "full";
    let calls = 0;
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Mock) => {
        calls += 1;
        cb(null, "", calls === 1 ? LOUDNORM_STDERR : "");
      }
    );

    await normalizeAudio("/in.mp4", "/out.wav");

    expect(execFileMock).toHaveBeenCalledTimes(2);
    const pass2Args = execFileMock.mock.calls[1][1] as string[];
    const filterChain = pass2Args[pass2Args.indexOf("-af") + 1];
    expect(filterChain).toContain("highpass=f=80");
    expect(filterChain).toContain("lowpass=f=7800");
    expect(filterChain).toContain("loudnorm=");
    expect(filterChain).toContain("linear=true");
  });

  it("cai para basic quando pass-1 não retorna JSON parseável (em vez de single-pass dinâmico)", async () => {
    process.env.TRANSCRIPTION_AUDIO_PREPROCESS = "loudness";
    mockSuccess(""); // sem JSON parseável

    await normalizeAudio("/in.mp4", "/out.wav");

    expect(execFileMock).toHaveBeenCalledTimes(2);
    // pass 2 = basic (sem -af)
    const pass2Args = execFileMock.mock.calls[1][1] as string[];
    expect(pass2Args).not.toContain("-af");
  });

  it("lança TRANSCRIPTION_FAILED quando ffmpeg falha", async () => {
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Mock) => {
        cb(new Error("ffmpeg crash"), "", "");
      }
    );

    await expect(normalizeAudio("/in.mp4", "/out.wav")).rejects.toMatchObject({
      code: "TRANSCRIPTION_FAILED",
    });
  });
});
