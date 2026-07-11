import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a *running* instance of the app (the Docker
// container on this host by default, or any URL via PLAYWRIGHT_BASE_URL).
// We don't spin the server up here because it needs Postgres + the imported
// card catalog; point at the already-running stack instead.
//
// Host note: this box is CachyOS (Arch), which Playwright doesn't officially
// support, so it uses the ubuntu24.04 fallback browser build. The system
// already has Chromium/Chrome installed, which supplies the shared libs that
// `playwright install-deps` (apt-only) would otherwise provide.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8477";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
