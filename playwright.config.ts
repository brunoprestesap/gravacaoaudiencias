import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import path from "path";

loadEnv({ path: path.join(__dirname, ".env.e2e") });

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const uploadDir = process.env.E2E_UPLOAD_DIR ?? "/tmp/audiencia-e2e-uploads";
const databaseUrl = process.env.E2E_DATABASE_URL ?? "";
const maritacaPort = process.env.E2E_MARITACA_PORT ?? "39871";

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts$/,
  testIgnore: ["**/fixtures/**", "**/support/**"],
  // Tests share the e2e database via cleanupE2eData() in afterEach. Serial
  // execution avoids cross-test contention (one test deleting another's seed).
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: require.resolve("./e2e/support/global-setup.ts"),
  globalTeardown: require.resolve("./e2e/support/global-teardown.ts"),
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      UPLOAD_DIR: uploadDir,
      LOCAL_TRANSCRIPTION_ENGINE: "mock",
      MARITACA_API_KEY: "test-key",
      MARITACA_BASE_URL: `http://127.0.0.1:${maritacaPort}`,
      E2E_MARITACA_PORT: maritacaPort,
      NEXTAUTH_URL: baseURL,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "e2e-secret-do-not-use-in-prod",
    },
  },
});
