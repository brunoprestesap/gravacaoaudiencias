import { execFile } from "child_process";
import { mkdtemp, rm, stat } from "fs/promises";
import path from "path";
import os from "os";
import {
  buildEncodingPlan,
  clamp,
  isMp4CodecCompatible,
  PJE_MAX_OUTPUT_SIZE_BYTES,
} from "@/lib/upload-encoding";

export interface MediaProbeInfo {
  durationSeconds: number | null;
  inputBitrateKbps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

export interface EncodingDiagnostics {
  inputBitrateKbps: number | null;
  targetVideoKbps: number;
  audioKbps: number;
  durationSeconds: number;
  inputBytes: number;
  outputBytes: number;
}

export interface ConversionTimings {
  ffmpegCheckMs: number;
  probeMs: number;
  remuxAttemptMs: number | null;
  remuxSucceeded: boolean;
  transcodeAttempts: Array<{
    mode: "two-pass" | "single-pass";
    preset: "faster" | "fast" | "medium";
    videoKbps: number;
    audioKbps: number;
    pass1Ms: number | null;
    pass2OrSingleMs: number;
    outputBytes: number;
  }>;
  totalConversionMs: number;
}

export function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function execFileWithOutput(
  command: string,
  args: string[],
  options?: { maxBuffer?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: options?.maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

let ffmpegAvailabilityPromise: Promise<void> | null = null;

export async function assertFfmpegAvailable() {
  if (!ffmpegAvailabilityPromise) {
    ffmpegAvailabilityPromise = (async () => {
      try {
        await execFileAsync("ffmpeg", ["-version"]);
        await execFileAsync("ffprobe", ["-version"]);
      } catch {
        throw new Error("FFMPEG_NOT_AVAILABLE");
      }
    })();
  }
  await ffmpegAvailabilityPromise;
}

/**
 * Probe rápido para detectar WebM corrompido / chunks remontados que perderam
 * trilha de áudio ou ficaram com duração zero. Acontece quando o browser
 * crash mid-record ou a concatenação de chunks emendou um chunk truncado.
 * Falhar cedo aqui dá uma 422 clara em vez de cascatar em "transcode failed".
 */
export interface RecordingIntegrityResult {
  ok: boolean;
  reason: "OK" | "PROBE_FAILED" | "NO_AUDIO" | "ZERO_DURATION";
  durationSeconds: number | null;
  audioCodec: string | null;
}

export async function assertRecordingIntegrity(
  inputPath: string
): Promise<RecordingIntegrityResult> {
  const probe = await probeMediaInfo(inputPath);
  if (!probe.audioCodec && probe.durationSeconds == null) {
    return { ok: false, reason: "PROBE_FAILED", durationSeconds: null, audioCodec: null };
  }
  if (!probe.audioCodec) {
    return {
      ok: false,
      reason: "NO_AUDIO",
      durationSeconds: probe.durationSeconds,
      audioCodec: null,
    };
  }
  if (!probe.durationSeconds || probe.durationSeconds <= 0) {
    return {
      ok: false,
      reason: "ZERO_DURATION",
      durationSeconds: probe.durationSeconds,
      audioCodec: probe.audioCodec,
    };
  }
  return {
    ok: true,
    reason: "OK",
    durationSeconds: probe.durationSeconds,
    audioCodec: probe.audioCodec,
  };
}

export async function probeMediaInfo(inputPath: string): Promise<MediaProbeInfo> {
  try {
    const { stdout } = await execFileWithOutput("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration,bit_rate:stream=codec_type,codec_name",
      "-of",
      "json",
      inputPath,
    ]);

    const parsed = JSON.parse(stdout) as {
      format?: {
        duration?: string;
        bit_rate?: string;
      };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
      }>;
    };

    const duration = Number.parseFloat(parsed.format?.duration ?? "");
    const bitRate = Number.parseFloat(parsed.format?.bit_rate ?? "");
    const videoCodec =
      parsed.streams?.find((stream) => stream.codec_type === "video")?.codec_name ?? null;
    const audioCodec =
      parsed.streams?.find((stream) => stream.codec_type === "audio")?.codec_name ?? null;

    return {
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
      inputBitrateKbps:
        Number.isFinite(bitRate) && bitRate > 0 ? Math.floor(bitRate / 1000) : null,
      videoCodec,
      audioCodec,
    };
  } catch {
    return { durationSeconds: null, inputBitrateKbps: null, videoCodec: null, audioCodec: null };
  }
}

export async function tryRemuxToMp4(inputPath: string, outputPath: string): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extrai um WAV mono 16kHz PCM do WebM original (Opus → PCM, uma só decode).
 * Esse arquivo é a fonte preferida da transcrição (Chirp 2): evita a 2ª
 * compressão lossy do MP4/AAC, que degrada a qualidade espectral entregue
 * ao modelo. Falha aqui não bloqueia upload — a transcrição cai para o MP4.
 */
export async function extractTranscriptionAudio(
  webmPath: string,
  wavPath: string
): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    webmPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    wavPath,
  ]);
}

export async function transcodeWebmToMp4Adaptive(
  inputPath: string,
  outputPath: string,
  durationHintSeconds: number | null
): Promise<{
  fileSize: number;
  durationSeconds: number;
  exceededPjeLimit: boolean;
  warning: string | null;
  diagnostics: EncodingDiagnostics;
  timings: ConversionTimings;
}> {
  const conversionStart = Date.now();
  const ffmpegCheckStart = Date.now();
  await assertFfmpegAvailable();
  const ffmpegCheckMs = Date.now() - ffmpegCheckStart;
  const probeStart = Date.now();
  const probeInfo = await probeMediaInfo(inputPath);
  const probeMs = Date.now() - probeStart;
  const durationSeconds = clamp(
    Math.round(durationHintSeconds ?? probeInfo.durationSeconds ?? 30 * 60),
    60,
    4 * 60 * 60
  );
  const inputStat = await stat(inputPath);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audiencia-transcode-"));
  const passLogPrefix = path.join(tempDir, "ffmpeg-passlog");
  const nullOutput = process.platform === "win32" ? "NUL" : "/dev/null";
  const attempts = buildEncodingPlan({
    durationSeconds,
    inputBitrateKbps: probeInfo.inputBitrateKbps,
  });

  try {
    let remuxAttemptMs: number | null = null;
    let remuxSucceeded = false;
    const transcodeAttempts: ConversionTimings["transcodeAttempts"] = [];
    const remuxCompatible = isMp4CodecCompatible({
      videoCodec: probeInfo.videoCodec,
      audioCodec: probeInfo.audioCodec,
    });
    if (remuxCompatible) {
      const remuxStart = Date.now();
      const remuxed = await tryRemuxToMp4(inputPath, outputPath);
      remuxAttemptMs = Date.now() - remuxStart;
      if (remuxed) {
        const remuxStat = await stat(outputPath);
        if (remuxStat.size <= PJE_MAX_OUTPUT_SIZE_BYTES) {
          remuxSucceeded = true;
          return {
            fileSize: remuxStat.size,
            durationSeconds,
            exceededPjeLimit: false,
            warning: null,
            diagnostics: {
              inputBitrateKbps: probeInfo.inputBitrateKbps,
              targetVideoKbps: probeInfo.inputBitrateKbps ?? 0,
              audioKbps: 0,
              durationSeconds,
              inputBytes: inputStat.size,
              outputBytes: remuxStat.size,
            },
            timings: {
              ffmpegCheckMs,
              probeMs,
              remuxAttemptMs,
              remuxSucceeded,
              transcodeAttempts,
              totalConversionMs: Date.now() - conversionStart,
            },
          };
        }
      }
    }

    let lastSize = 0;
    let lastDiagnostics: EncodingDiagnostics = {
      inputBitrateKbps: probeInfo.inputBitrateKbps,
      targetVideoKbps: 0,
      audioKbps: 0,
      durationSeconds,
      inputBytes: inputStat.size,
      outputBytes: 0,
    };
    for (const attempt of attempts) {
      const attemptMeta: ConversionTimings["transcodeAttempts"][number] = {
        mode: attempt.mode,
        preset: attempt.preset,
        videoKbps: attempt.videoKbps,
        audioKbps: attempt.audioKbps,
        pass1Ms: null,
        pass2OrSingleMs: 0,
        outputBytes: 0,
      };
      const videoKbps = attempt.videoKbps;
      const videoBitrate = `${videoKbps}k`;
      const audioBitrate = `${attempt.audioKbps}k`;
      const bufsize = `${Math.floor(videoKbps * 2)}k`;

      if (attempt.mode === "two-pass") {
        const pass1Start = Date.now();
        await execFileAsync("ffmpeg", [
          "-y", "-i", inputPath,
          "-c:v", "libx264", "-preset", attempt.preset,
          "-b:v", videoBitrate, "-maxrate", videoBitrate, "-bufsize", bufsize,
          "-pix_fmt", "yuv420p",
          "-pass", "1", "-passlogfile", passLogPrefix,
          "-an", "-f", "mp4", nullOutput,
        ]);
        attemptMeta.pass1Ms = Date.now() - pass1Start;

        const pass2Start = Date.now();
        await execFileAsync("ffmpeg", [
          "-y", "-i", inputPath,
          "-c:v", "libx264", "-preset", attempt.preset,
          "-b:v", videoBitrate, "-maxrate", videoBitrate, "-bufsize", bufsize,
          "-pix_fmt", "yuv420p",
          "-pass", "2", "-passlogfile", passLogPrefix,
          "-c:a", "aac", "-b:a", audioBitrate,
          "-movflags", "+faststart", outputPath,
        ]);
        attemptMeta.pass2OrSingleMs = Date.now() - pass2Start;
      } else {
        const singlePassStart = Date.now();
        await execFileAsync("ffmpeg", [
          "-y", "-i", inputPath,
          "-c:v", "libx264", "-preset", attempt.preset,
          "-b:v", videoBitrate, "-maxrate", videoBitrate, "-bufsize", bufsize,
          "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", audioBitrate,
          "-movflags", "+faststart", outputPath,
        ]);
        attemptMeta.pass2OrSingleMs = Date.now() - singlePassStart;
      }

      const finalStat = await stat(outputPath);
      lastSize = finalStat.size;
      attemptMeta.outputBytes = lastSize;
      transcodeAttempts.push(attemptMeta);
      lastDiagnostics = {
        inputBitrateKbps: probeInfo.inputBitrateKbps,
        targetVideoKbps: videoKbps,
        audioKbps: attempt.audioKbps,
        durationSeconds,
        inputBytes: inputStat.size,
        outputBytes: lastSize,
      };
      if (lastSize <= PJE_MAX_OUTPUT_SIZE_BYTES) {
        return {
          fileSize: lastSize,
          durationSeconds,
          exceededPjeLimit: false,
          warning: null,
          diagnostics: lastDiagnostics,
          timings: {
            ffmpegCheckMs,
            probeMs,
            remuxAttemptMs,
            remuxSucceeded: false,
            transcodeAttempts,
            totalConversionMs: Date.now() - conversionStart,
          },
        };
      }
    }

    return {
      fileSize: lastSize,
      durationSeconds,
      exceededPjeLimit: lastSize > PJE_MAX_OUTPUT_SIZE_BYTES,
      warning:
        "Arquivo final ultrapassou 300MB após otimização. A gravação foi salva, mas pode não ser aceita no PJe.",
      diagnostics: lastDiagnostics,
      timings: {
        ffmpegCheckMs,
        probeMs,
        remuxAttemptMs,
        remuxSucceeded: false,
        transcodeAttempts,
        totalConversionMs: Date.now() - conversionStart,
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
