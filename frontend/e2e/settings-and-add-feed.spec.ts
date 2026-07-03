import { expect, test } from "@playwright/test";

test("saves settings and adds a feed from the empty subscriptions state", async ({
  page,
}) => {
  let podcasts = [] as Array<{
    id: number;
    title: string;
    rssUrl: string;
    description: string | null;
    imageUrl: string | null;
    lastChecked: string | null;
    updateTime: string | null;
  }>;
  let dailyRefreshTime = "03:00";

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: { id: 1, username: "qa" },
        setupRequired: false,
      }),
    });
  });

  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON() as {
        dailyRefreshTime?: string;
        proxyEnabled?: boolean;
      };
      if (payload.dailyRefreshTime) {
        dailyRefreshTime = payload.dailyRefreshTime;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          settings: {
            dailyRefreshTime,
            proxyEnabled: false,
            proxyConfigured: true,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        settings: {
          dailyRefreshTime,
          proxyEnabled: false,
          proxyConfigured: true,
        },
      }),
    });
  });

  await page.route("**/api/jobs/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        scheduler: {
          state: "idle",
          lastRunAt: null,
          lastSuccessAt: null,
          lastFailureAt: null,
        },
      }),
    });
  });

  await page.route("**/api/proxy/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        proxy: {
          proxyEnabled: false,
          proxyConfigured: true,
          status: "off",
          externalIp: null,
          country: null,
          error: null,
        },
      }),
    });
  });

  await page.route("**/api/podcasts", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as { rssUrl: string };
      podcasts = [
        {
          id: 1,
          title: "New Feed",
          rssUrl: payload.rssUrl,
          description: "Imported in Playwright",
          imageUrl: null,
          lastChecked: null,
          updateTime: null,
        },
      ];

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          podcast: podcasts[0],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        podcasts,
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
      body: JSON.stringify({
        episodes: [
          {
            id: 101,
            podcastId: 1,
            title: "First imported episode",
            description: "Imported with the feed",
            audioUrl: "https://example.com/audio.mp3",
            duration: 1200,
            downloaded: false,
            isListened: false,
            publishedAt: "2026-05-22T10:00:00Z",
          },
        ],
      }),
    });
  });

  await page.goto("/settings");

  await page.getByLabel("Use SOCKS5 proxy").click();
  await page.fill('input[type="time"]', "04:15");
  await page.getByRole("button", { name: "Save time" }).click();

  await expect(page.locator('input[type="time"]')).toHaveValue("04:15");
  await expect(
    page.getByText("Status: idle · last refresh never")
  ).toBeVisible();

  await page.goto("/subscriptions");

  await expect(page.getByText("No podcasts yet")).toBeVisible();
  await page.getByRole("button", { name: "Add RSS feed" }).click();

  await page.getByLabel("Paste RSS feed URL").fill("https://example.com/feed.xml");
  await page.getByRole("button", { name: "Add Feed" }).click();

  await expect(
    page.getByRole("button", { name: /New Feed/ })
  ).toBeVisible();
  await expect(page.getByText("1 / 1 episodes")).toBeVisible();
});
