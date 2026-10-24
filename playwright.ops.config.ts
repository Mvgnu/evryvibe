import { defineConfig } from "@playwright/test";

const password = process.env.EVRYVIBE_OPERATOR_PASSWORD;
if (!password)
  throw new Error("Set EVRYVIBE_OPERATOR_PASSWORD for operator tests.");
if (!process.env.DATABASE_URL?.includes("test"))
  throw new Error("Operator tests require a disposable test DATABASE_URL.");

export default defineConfig({
  testDir: "./tests/operator",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: "http://localhost:3102",
    httpCredentials: { username: "operator", password },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx next start --port 3102",
    url: "http://localhost:3102",
    reuseExistingServer: !process.env.CI,
  },
});
