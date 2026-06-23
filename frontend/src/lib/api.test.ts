import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "./api";

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends JSON bodies with same-origin credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ settings: { dailyRefreshTime: "03:00", proxyEnabled: true, proxyConfigured: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.settings.update({ proxyEnabled: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
        body: JSON.stringify({ proxyEnabled: true }),
        headers: expect.any(Headers),
      })
    );

    const [, request] = fetchMock.mock.calls[0];
    const headers = request.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("disables browser caching for GET requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          settings: {
            dailyRefreshTime: "03:00",
            proxyEnabled: true,
            proxyConfigured: true,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.settings.get();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
      })
    );
  });

  it("throws ApiError details from JSON error responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "INVALID_SETTINGS", message: "Bad settings" },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );

    await expect(api.settings.update({ proxyEnabled: true })).rejects.toEqual(
      new ApiError("Bad settings", "INVALID_SETTINGS", 400)
    );
  });

  it("falls back to HTTP_ERROR for non-JSON failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("nope", {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    await expect(api.settings.get()).rejects.toEqual(
      new ApiError("Bad Gateway", "HTTP_ERROR", 502)
    );
  });
});
