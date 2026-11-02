import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveUploadPath } from "./upload-path";

describe("resolveUploadPath", () => {
  beforeEach(() => vi.stubEnv("UPLOAD_DIR", "/srv/uploads"));
  afterEach(() => vi.unstubAllEnvs());

  it("resolve caminhos dentro de UPLOAD_DIR", () => {
    expect(resolveUploadPath("2026/11/3-vara/a.mp4")).toBe("/srv/uploads/2026/11/3-vara/a.mp4");
    expect(resolveUploadPath("2026/../a.mp4")).toBe("/srv/uploads/a.mp4");
  });

  it.each([
    "../../.env",
    "2026/../../fora.mp4",
    "/etc/passwd",
    "../uploads-vizinho/a.mp4",
    "",
    ".",
    "..",
  ])("rejeita %j", (relative) => {
    expect(resolveUploadPath(relative)).toBeNull();
  });

  it("usa <cwd>/uploads quando UPLOAD_DIR não está definido", () => {
    vi.stubEnv("UPLOAD_DIR", "");
    expect(resolveUploadPath("a.mp4")).toBe(path.join(process.cwd(), "uploads", "a.mp4"));
  });
});
