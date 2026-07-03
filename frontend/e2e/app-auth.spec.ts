import { expect, test } from "@playwright/test";

test("logs in and lands on subscriptions", async ({ page }) => {
  let sessionCalls = 0;

  await page.route("**/api/auth/session", async (route) => {
    sessionCalls += 1;

    const body =
      sessionCalls === 1
        ? { authenticated: false, user: null, setupRequired: false }
        : {
            authenticated: true,
            user: { id: 1, username: "qa" },
            setupRequired: false,
          };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: 1, username: "qa" },
      }),
    });
  });

  await page.route("**/api/podcasts", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        podcasts: [],
      }),
    });
  });

  await page.route("**/api/playlist", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  await page.route("**/api/podcasts/1/episodes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ episodes: [] }),
    });
  });

  await page.goto("/login");

  await page.getByLabel("Username").fill("qa");
  await page.getByRole("textbox", { name: "Password" }).fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/subscriptions$/);
  await expect(page.getByRole("heading", { name: "No podcasts" })).toBeVisible();
  await expect(page.getByText("No podcasts yet")).toBeVisible();
});
