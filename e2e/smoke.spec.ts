import { test, expect } from "@playwright/test";

// Smoke test: proves the app is served and the login gate renders. This is the
// baseline that confirms Playwright + the browser + the running stack all work
// together on this host. Grow this folder with real flows (deck builder search,
// starting a game, the deck-legality gate) as needed.
test("home page serves and shows the login gate", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/MTG PvP/i);
  await expect(page.getByPlaceholder("Username")).toBeVisible();
  await expect(page.getByPlaceholder("Password")).toBeVisible();
});
