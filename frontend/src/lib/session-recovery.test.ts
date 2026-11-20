import { describe, expect, it, vi } from "vitest";

import { api, ApiError } from "@/lib/api";
import {
  SESSION_RETRY_CONFIG,
  fetchSessionWithTimeout,
  isTransientSessionError,
  sleepWithSignal,
} from "./session-recovery";

describe("session-recovery", () => {
  describe("SESSION_RETRY_CONFIG", () => {
    it("defines foreground and background retry policies", () => {
      expect(SESSION_RETRY_CONFIG.foreground.maxAttempts).toBe(3);
      expect(SESSION_RETRY_CONFIG.foreground.timeoutMs).toBe(2500);
      expect(SESSION_RETRY_CONFIG.foreground.backoffDelays).toEqual([400, 800]);

      expect(SESSION_RETRY_CONFIG.background.maxAttempts).toBe(1);
      expect(SESSION_RETRY_CONFIG.background.timeoutMs).toBe(4000);
      expect(SESSION_RETRY_CONFIG.background.backoffDelays).toEqual([]);
    });
  });

  describe("isTransientSessionError", () => {
    it("returns true for TypeError (network / fetch failures)", () => {
      expect(isTransientSessionError(new TypeError("Failed to fetch"))).toBe(true);
    });

    it("returns true for AbortError (timeouts)", () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      expect(isTransientSessionError(abortError)).toBe(true);
    });

    it("returns true for server 5xx ApiError", () => {
      expect(isTransientSessionError(new ApiError("Internal Server Error", "SERVER_ERROR", 500))).toBe(true);
      expect(isTransientSessionError(new ApiError("Bad Gateway", "HTTP_ERROR", 502))).toBe(true);
      expect(isTransientSessionError(new ApiError("Service Unavailable", "HTTP_ERROR", 503))).toBe(true);
      expect(isTransientSessionError(new ApiError("Gateway Timeout", "HTTP_ERROR", 504))).toBe(true);
    });

    it("returns true for common network error message patterns", () => {
      expect(isTransientSessionError(new Error("connect ECONNREFUSED 127.0.0.1:5050"))).toBe(true);
      expect(isTransientSessionError(new Error("connect ETIMEDOUT"))).toBe(true);
      expect(isTransientSessionError(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
    });

    it("returns false for client 4xx ApiError", () => {
      expect(isTransientSessionError(new ApiError("Bad Request", "BAD_REQUEST", 400))).toBe(false);
      expect(isTransientSessionError(new ApiError("Authentication is required", "UNAUTHORIZED", 401))).toBe(false);
      expect(isTransientSessionError(new ApiError("Forbidden", "FORBIDDEN", 403))).toBe(false);
      expect(isTransientSessionError(new ApiError("Not Found", "NOT_FOUND", 404))).toBe(false);
    });

    it("returns false for generic errors, null, and undefined", () => {
      expect(isTransientSessionError(new Error("Generic application failure"))).toBe(false);
      expect(isTransientSessionError(null)).toBe(false);
      expect(isTransientSessionError(undefined)).toBe(false);
      expect(isTransientSessionError("string error")).toBe(false);
      expect(isTransientSessionError(123)).toBe(false);
    });
  });

  describe("sleepWithSignal", () => {
    it("resolves after specified delay when signal does not abort", async () => {
      const start = Date.now();
      await sleepWithSignal(30);
      expect(Date.now() - start).toBeGreaterThanOrEqual(25);
    });

    it("resolves immediately when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const start = Date.now();
      await sleepWithSignal(5000, controller.signal);
      expect(Date.now() - start).toBeLessThan(100);
    });

    it("resolves early when signal aborts during sleep", async () => {
      const controller = new AbortController();
      const start = Date.now();
      const sleepPromise = sleepWithSignal(5000, controller.signal);
      setTimeout(() => controller.abort(), 20);
      await sleepPromise;
      expect(Date.now() - start).toBeLessThan(200);
    });
  });

  describe("fetchSessionWithTimeout", () => {
    it("returns session when api.auth.session resolves within timeout", async () => {
      const mockSession = {
        authenticated: true,
        user: { id: 1, username: "testuser" },
        setupRequired: false,
      };

      vi.spyOn(api.auth, "session").mockResolvedValue(mockSession);

      const result = await fetchSessionWithTimeout(1000);
      expect(result).toEqual(mockSession);
    });

    it("aborts and rejects with AbortError when timeout expires", async () => {
      vi.spyOn(api.auth, "session").mockImplementation(
        ({ signal } = {}) =>
          new Promise((_, reject) => {
            if (signal) {
              signal.addEventListener("abort", () => {
                const err = new Error("Aborted");
                err.name = "AbortError";
                reject(err);
              });
            }
          })
      );

      await expect(fetchSessionWithTimeout(30)).rejects.toMatchObject({
        name: "AbortError",
      });
    });

    it("aborts when parent signal is already aborted", async () => {
      const parentController = new AbortController();
      parentController.abort();

      vi.spyOn(api.auth, "session").mockImplementation(
        ({ signal } = {}) =>
          new Promise((_, reject) => {
            if (signal?.aborted) {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            }
          })
      );

      await expect(
        fetchSessionWithTimeout(1000, parentController.signal)
      ).rejects.toMatchObject({
        name: "AbortError",
      });
    });

    it("aborts when parent signal aborts mid-flight", async () => {
      const parentController = new AbortController();

      vi.spyOn(api.auth, "session").mockImplementation(
        ({ signal } = {}) =>
          new Promise((_, reject) => {
            if (signal) {
              signal.addEventListener("abort", () => {
                const err = new Error("Parent Aborted");
                err.name = "AbortError";
                reject(err);
              });
            }
          })
      );

      const promise = fetchSessionWithTimeout(1000, parentController.signal);
      parentController.abort();

      await expect(promise).rejects.toMatchObject({
        name: "AbortError",
      });
    });
  });
});
