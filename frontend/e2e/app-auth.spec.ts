import { expect, test } from "@playwright/test";

import { installAppShellApiMocks } from "./api-mocks";

test("logs in and lands on subscriptions", async ({ page }) => {
  let sessionCalls = 0;

  await installAppShellApiMocks(page);

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

  await page.route("**/api/episodes", async (route) => {
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
  await expect(
    page.getByRole("heading", { name: "No podcasts", exact: true })
  ).toBeVisible();
  await expect(page.getByText("No podcasts yet")).toBeVisible();
});

test("returns to login when a protected request finds an expired session", async ({
  page,
}) => {
  let expired = false;

  await installAppShellApiMocks(page);

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: !expired,
        user: expired ? null : { id: 1, username: "qa" },
        setupRequired: false,
      }),
    });
  });
  await page.route("**/api/podcasts", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        podcasts: [
          {
            id: 1,
            title: "Cached QA Podcast",
            description: "Visible before the session expires",
            imageUrl: null,
            rssUrl: "https://example.com/feed.xml",
            lastChecked: null,
            updateTime: null,
          },
        ],
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
  await page.route("**/api/episodes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        episodes: [
          {
            id: 1,
            podcastId: 1,
            title: "Cached QA Episode",
            description: "Visible before the session expires",
            showNotes: null,
            audioUrl: "https://example.com/episode.mp3",
            duration: 600,
            downloaded: false,
            isListened: false,
            publishedAt: "2026-08-12T04:00:00Z",
          },
        ],
      }),
    });
  });
  await page.route("**/api/podcasts/refresh-all", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication is required",
        },
      }),
    });
  });

  await page.goto("/subscriptions");
  const cachedPodcastHeading = page.getByRole("heading", {
    name: "Cached QA Podcast",
    exact: true,
  });
  await expect(cachedPodcastHeading).toBeVisible();

  expired = true;
  await page.getByRole("button", { name: "Refresh all", exact: true }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Log in and keep listening" })
  ).toBeVisible();
  await expect(cachedPodcastHeading).toHaveCount(0);
  await expect(page.getByText("Authentication is required")).toHaveCount(0);
});
