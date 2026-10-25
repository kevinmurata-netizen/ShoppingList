import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    },
  },
  webServer: {
    command: "node server/index.js",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "3100",
      DATA_PATH: `.data/browser-test-${Date.now()}.sqlite`,
      NODE_ENV: "production",
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
      REQUIRE_REMOTE_DATABASE: "false",
    },
  },
});
