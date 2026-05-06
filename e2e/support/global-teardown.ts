import { promises as fs } from "fs";
import { cleanupE2eData, disconnectPrisma } from "../fixtures/db";

export default async function globalTeardown(): Promise<void> {
  const mock = (globalThis as { __maritacaMock?: { stop(): Promise<void> } }).__maritacaMock;
  if (mock) {
    await mock.stop();
  }

  if (process.env.E2E_DATABASE_URL) {
    try {
      await cleanupE2eData();
    } catch (err) {
      console.warn("[e2e] cleanup falhou:", err);
    }
    await disconnectPrisma();
  }

  const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
  await fs.rm(uploadDir, { recursive: true, force: true });
}
