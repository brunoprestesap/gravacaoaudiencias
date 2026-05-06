import { describe, expect, it, vi } from "vitest";
import { uploadWavToGcs } from "./gcs-upload";
import { LocalTranscriptionError } from "../errors";

interface FakeFile {
  delete: ReturnType<typeof vi.fn>;
}

interface FakeBucket {
  upload: ReturnType<typeof vi.fn>;
  file: ReturnType<typeof vi.fn>;
  _file: FakeFile;
}

function createFakeStorage(opts: { uploadShouldFail?: boolean; deleteShouldFail?: boolean } = {}) {
  const fakeFile: FakeFile = {
    delete: vi.fn(async () =>
      opts.deleteShouldFail ? Promise.reject(new Error("delete failed")) : undefined
    ),
  };
  const fakeBucket: FakeBucket = {
    upload: vi.fn(async () =>
      opts.uploadShouldFail ? Promise.reject(new Error("upload failed")) : undefined
    ),
    file: vi.fn(() => fakeFile),
    _file: fakeFile,
  };
  return {
    bucket: vi.fn(() => fakeBucket),
    _bucket: fakeBucket,
  } as const;
}

describe("uploadWavToGcs", () => {
  it("envia áudio para o bucket com URI gs:// e expõe cleanup", async () => {
    const storage = createFakeStorage();
    const result = await uploadWavToGcs(
      storage as unknown as Parameters<typeof uploadWavToGcs>[0],
      "audiencia-bucket",
      "/tmp/audio.wav"
    );

    expect(storage.bucket).toHaveBeenCalledWith("audiencia-bucket");
    expect(storage._bucket.upload).toHaveBeenCalledWith(
      "/tmp/audio.wav",
      expect.objectContaining({
        resumable: false,
        metadata: expect.objectContaining({ contentType: "audio/wav" }),
      })
    );
    expect(result.gcsUri).toMatch(/^gs:\/\/audiencia-bucket\/transcricoes\/[a-f0-9-]+\.wav$/);

    await result.cleanup();
    expect(storage._bucket._file.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it("converte falha de upload em LocalTranscriptionError", async () => {
    const storage = createFakeStorage({ uploadShouldFail: true });

    await expect(
      uploadWavToGcs(
        storage as unknown as Parameters<typeof uploadWavToGcs>[0],
        "audiencia-bucket",
        "/tmp/audio.wav"
      )
    ).rejects.toBeInstanceOf(LocalTranscriptionError);
  });

  it("cleanup é resiliente a falha no delete", async () => {
    const storage = createFakeStorage({ deleteShouldFail: true });
    const result = await uploadWavToGcs(
      storage as unknown as Parameters<typeof uploadWavToGcs>[0],
      "audiencia-bucket",
      "/tmp/audio.wav"
    );

    await expect(result.cleanup()).resolves.toBeUndefined();
  });
});
