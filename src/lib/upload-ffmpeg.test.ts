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
[ "$last" = "/dev/null" ] && exit 0
size=\${FAKE_FFMPEG_FIRST_BYTES:-1}
case " $* " in *" -preset fast "*) size=\${FAKE_FFMPEG_SECOND_BYTES:-1} ;; esac
dd if=/dev/zero of="$last" bs=1 count=0 seek="$size" 2>/dev/null
`;

const OVER_LIMIT_BYTES = 310 * 1024 * 1024;
const REDUCED_WARNING = "A imagem do vídeo foi reduzida para caber no limite de 300 MB do PJe.";
const LIMIT_WARNING =
  "Arquivo final ultrapassou 300MB após otimização. A gravação foi salva, mas pode não ser aceita no PJe.";

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
    delete process.env.FAKE_FFMPEG_FIRST_BYTES;
    delete process.env.FAKE_FFMPEG_SECOND_BYTES;
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

describe("redução para o limite do PJe", () => {
  let dir: string;
  let logPath: string;
  const originalPath = process.env.PATH;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "upload-ffmpeg-pje-"));
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
    delete process.env.FAKE_FFMPEG_FIRST_BYTES;
    delete process.env.FAKE_FFMPEG_SECOND_BYTES;
    await rm(dir, { recursive: true, force: true });
  });

  const calls = async () => (await readFile(logPath, "utf-8")).trim().split("\n");
  const convert = (duration: number) =>
    transcodeWebmToMp4Adaptive(path.join(dir, "in.webm"), path.join(dir, "out.mp4"), duration);

  it("em 2 horas aplica a escala nos dois passos e o áudio mono na saída", async () => {
    const result = await convert(7200);

    const [pass1, pass2] = await calls();
    const scale = "-vf scale=-2:trunc(min(480\\,ih)/2)*2";
    expect(pass1).toContain(scale);
    expect(pass2).toContain(scale);
    expect(pass1).not.toContain("-ac 1");
    expect(pass2).toContain("-b:v 275k");
    expect(pass2).toContain("-b:a 64k -ac 1");
    expect(result.warning).toBe(REDUCED_WARNING);
    expect(result.exceededPjeLimit).toBe(false);
    expect(result.diagnostics).toMatchObject({ qualityReduced: true, maxHeight: 480 });
  });

  it("em gravação curta não muda a escala nem o áudio", async () => {
    const result = await convert(30 * 60);

    const logged = await calls();
    expect(logged.some((call) => call.includes("-vf"))).toBe(false);
    expect(logged.some((call) => call.includes("-ac 1"))).toBe(false);
    expect(logged[1]).toContain("-b:a 96k");
    expect(result.warning).toBeNull();
    expect(result.diagnostics).toMatchObject({ qualityReduced: false, maxHeight: null });
  });

  it("a segunda tentativa mantém 480p, usa o tamanho medido e avisa da redução", async () => {
    process.env.FAKE_FFMPEG_FIRST_BYTES = String(OVER_LIMIT_BYTES);

    const result = await convert(7200);

    const logged = await calls();
    expect(logged).toHaveLength(3);
    expect(logged[2]).toContain("-preset fast");
    expect(logged[2]).toContain("min(480");
    const expectedKbps = Math.floor((339 * 305135616) / OVER_LIMIT_BYTES) - 64;
    expect(logged[2]).toContain(`-b:v ${expectedKbps}k`);
    expect(result.warning).toBe(REDUCED_WARNING);
    expect(result.exceededPjeLimit).toBe(false);
  });

  it("o aviso de limite tem prioridade sobre o de redução", async () => {
    process.env.FAKE_FFMPEG_FIRST_BYTES = String(OVER_LIMIT_BYTES);
    process.env.FAKE_FFMPEG_SECOND_BYTES = String(OVER_LIMIT_BYTES);

    const result = await convert(7200);

    expect(result.warning).toBe(LIMIT_WARNING);
    expect(result.exceededPjeLimit).toBe(true);
    expect(result.diagnostics).toMatchObject({ qualityReduced: true, maxHeight: 480 });
  });

  it("no piso salva, avisa do limite e não tenta de novo", async () => {
    process.env.FAKE_FFMPEG_FIRST_BYTES = String(OVER_LIMIT_BYTES);

    const result = await convert(4 * 60 * 60);

    const logged = await calls();
    expect(logged).toHaveLength(2);
    expect(logged[1]).toContain("-b:v 150k");
    expect(logged[1]).toContain("min(360");
    expect(result.warning).toBe(LIMIT_WARNING);
    expect(result.exceededPjeLimit).toBe(true);
  });
});
