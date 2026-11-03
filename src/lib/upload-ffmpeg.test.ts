import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  execFileAsync,
  extractTranscriptionAudio,
  transcodeWebmToMp4Adaptive,
  tryRemuxToMp4,
} from "@/lib/upload-ffmpeg";

const TWO_MIB = 2 * 1024 * 1024;

// Um FFmpeg de mentira, no PATH, que escreve mais que o limite padrão de 1 MiB
// do execFile. É o que uma conversão real faz depois de cerca de 45 minutos.
const FAKE_FFMPEG = `#!/bin/sh
[ "$1" = "-version" ] && exit 0
echo "$*" >> "$FAKE_FFMPEG_LOG"
head -c ${TWO_MIB} /dev/zero >&2
for last; do :; done
[ "$last" = "/dev/null" ] || printf x > "$last"
`;

const FAKE_FFPROBE = `#!/bin/sh
[ "$1" = "-version" ] && exit 0
printf '%s' '${JSON.stringify({
  format: { duration: "7200", bit_rate: "2000000" },
  streams: [
    { codec_type: "video", codec_name: "vp8" },
    { codec_type: "audio", codec_name: "opus" },
  ],
})}'
`;

describe("upload-ffmpeg com saída longa", () => {
  let dir: string;
  let logPath: string;
  const originalPath = process.env.PATH;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "upload-ffmpeg-test-"));
    logPath = path.join(dir, "calls.log");
    await writeFile(path.join(dir, "ffmpeg"), FAKE_FFMPEG);
    await writeFile(path.join(dir, "ffprobe"), FAKE_FFPROBE);
    await chmod(path.join(dir, "ffmpeg"), 0o755);
    await chmod(path.join(dir, "ffprobe"), 0o755);
    await writeFile(path.join(dir, "in.webm"), "x");
    await writeFile(logPath, "");
    process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
    process.env.FAKE_FFMPEG_LOG = logPath;
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    delete process.env.FAKE_FFMPEG_LOG;
    await rm(dir, { recursive: true, force: true });
  });

  const calls = async () => (await readFile(logPath, "utf-8")).trim().split("\n");

  it("execFileAsync não encerra o processo que escreve mais de 1 MiB", async () => {
    await expect(
      execFileAsync(process.execPath, ["-e", `process.stderr.write("x".repeat(${TWO_MIB}))`])
    ).resolves.toBeUndefined();
  });

  it("a conversão termina os dois passos, sem pedir progresso ao FFmpeg", async () => {
    const output = path.join(dir, "out.mp4");

    const result = await transcodeWebmToMp4Adaptive(path.join(dir, "in.webm"), output, 7200);

    expect(result.timings.transcodeAttempts[0]?.mode).toBe("two-pass");
    expect((await stat(output)).size).toBe(1);
    const logged = await calls();
    expect(logged.some((call) => call.includes("-pass 1"))).toBe(true);
    expect(logged.some((call) => call.includes("-pass 2"))).toBe(true);
    expect(logged.every((call) => call.includes("-nostats"))).toBe(true);
  });

  it("o remux não falha por causa da saída longa", async () => {
    await expect(tryRemuxToMp4(path.join(dir, "in.webm"), path.join(dir, "out.mp4"))).resolves.toBe(
      true
    );
    expect((await calls())[0]).toContain("-nostats");
  });

  it("a extração do WAV não falha por causa da saída longa", async () => {
    await expect(
      extractTranscriptionAudio(path.join(dir, "in.webm"), path.join(dir, "out.wav"))
    ).resolves.toBeUndefined();
    expect((await calls())[0]).toContain("-nostats");
  });
});
