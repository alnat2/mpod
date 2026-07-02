import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { SettingsScreen } from "./settings-screen";

vi.mock("@/components/mpod", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("./add-podcast-modal", () => ({
  AddPodcastModal: () => null,
}));

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );

  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe("SettingsScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigateMock.mockReset();
    window.localStorage.clear();
    document.documentElement.className = "";

    vi.spyOn(api.settings, "get").mockResolvedValue({
      settings: {
        dailyRefreshTime: "03:00",
        playbackSpeed: "Speed 1.3x",
        proxyEnabled: false,
        proxyConfigured: true,
        appBuild: "test-build",
      },
    });
    vi.spyOn(api.settings, "proxyStatus").mockResolvedValue({
      proxy: {
        proxyEnabled: false,
        proxyConfigured: true,
        status: "off",
        externalIp: null,
        country: null,
        error: null,
      },
    });
    vi.spyOn(api.jobs, "status").mockResolvedValue({
      scheduler: {
        state: "idle",
        lastRunAt: null,
        lastSuccessAt: null,
      },
    });
  });

  function renderScreen(onSessionChange?: () => void | Promise<void>) {
    return render(
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <MemoryRouter>
          <SettingsScreen onSessionChange={onSessionChange} />
        </MemoryRouter>
      </ThemeProvider>
    );
  }

  async function expectProxyIdentityToUseThemeTokens() {
    expect(await screen.findByText("43.32.112.45")).toHaveClass("text-foreground");
    expect(screen.getByText("UK")).toHaveClass("text-foreground");
    expect(screen.getByText("Current IP:")).toHaveClass("text-muted-foreground");
    expect(screen.getByText("Geo:")).toHaveClass("text-muted-foreground");
  }

  it("loads settings and scheduler status", async () => {
    renderScreen();

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("03:00")).toBeInTheDocument();
    expect(
      screen.getByText("Status: idle · last refresh never")
    ).toBeInTheDocument();
    expect(screen.getByText("Proxy is off")).toBeInTheDocument();
  });

  it("saves the daily refresh time", async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api.settings, "update").mockResolvedValue({
      settings: {
        dailyRefreshTime: "04:30",
        playbackSpeed: "Speed 1.3x",
        proxyEnabled: false,
        proxyConfigured: true,
        appBuild: "test-build",
      },
    });

    renderScreen();

    const timeInput = await screen.findByDisplayValue("03:00");
    await user.clear(timeInput);
    await user.type(timeInput, "04:30");
    await user.click(screen.getByRole("button", { name: "Save time" }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ dailyRefreshTime: "04:30" });
    });
  });

  it("updates proxy enabled state when the switch is clicked", async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api.settings, "update").mockResolvedValue({
      settings: {
        dailyRefreshTime: "03:00",
        playbackSpeed: "Speed 1.3x",
        proxyEnabled: true,
        proxyConfigured: true,
        appBuild: "test-build",
      },
    });
    vi.spyOn(api.settings, "proxyStatus").mockResolvedValue({
      proxy: {
        proxyEnabled: true,
        proxyConfigured: true,
        status: "ok",
        externalIp: "43.32.112.45",
        country: "UK",
        error: null,
      },
    });

    renderScreen();

    const proxySwitch = await screen.findByRole("switch", {
      name: "Use SOCKS5 proxy",
    });
    await user.click(proxySwitch);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ proxyEnabled: true });
    });
    await expectProxyIdentityToUseThemeTokens();
  });

  it("toggles dark theme locally without saving backend settings", async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api.settings, "update");

    renderScreen();

    await screen.findByRole("heading", { name: "Settings" });
    const themeSwitch = screen.getByRole("switch", {
      name: "Use dark theme",
    });
    expect(
      screen.getByText("Use this option if it feels more comfortable for you.")
    ).toBeInTheDocument();

    await user.click(themeSwitch);

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
      expect(window.localStorage.getItem("theme")).toBe("dark");
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("shows current proxy identity when proxy is enabled", async () => {
    vi.spyOn(api.settings, "get").mockResolvedValue({
      settings: {
        dailyRefreshTime: "03:00",
        playbackSpeed: "Speed 1.3x",
        proxyEnabled: true,
        proxyConfigured: true,
        appBuild: "test-build",
      },
    });
    vi.spyOn(api.settings, "proxyStatus").mockResolvedValue({
      proxy: {
        proxyEnabled: true,
        proxyConfigured: true,
        status: "ok",
        externalIp: "43.32.112.45",
        country: "UK",
        error: null,
      },
    });

    renderScreen();

    await expectProxyIdentityToUseThemeTokens();
  });

  it("shows the backend proxy error when proxy lookup fails", async () => {
    vi.spyOn(api.settings, "get").mockResolvedValue({
      settings: {
        dailyRefreshTime: "03:00",
        playbackSpeed: "Speed 1.3x",
        proxyEnabled: true,
        proxyConfigured: true,
        appBuild: "test-build",
      },
    });
    vi.spyOn(api.settings, "proxyStatus").mockResolvedValue({
      proxy: {
        proxyEnabled: true,
        proxyConfigured: true,
        status: "error",
        externalIp: null,
        country: null,
        error: "request proxy status: lookup failed",
      },
    });

    renderScreen();

    expect(
      await screen.findByText("request proxy status: lookup failed")
    ).toBeInTheDocument();
  });

  it("keeps proxy controls enabled when runtime status confirms configuration", async () => {
    vi.spyOn(api.settings, "get").mockResolvedValue({
      settings: {
        dailyRefreshTime: "03:00",
        playbackSpeed: "Speed 1.3x",
        proxyEnabled: false,
        proxyConfigured: false,
        appBuild: "test-build",
      },
    });
    vi.spyOn(api.settings, "proxyStatus").mockResolvedValue({
      proxy: {
        proxyEnabled: false,
        proxyConfigured: true,
        status: "off",
        externalIp: null,
        country: null,
        error: null,
      },
    });

    renderScreen();

    expect(await screen.findByText("Proxy is off")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Use SOCKS5 proxy" })).toBeEnabled();
  });

  it("logs out and redirects to login", async () => {
    const user = userEvent.setup();
    const onSessionChange = vi.fn();
    vi.spyOn(api.auth, "logout").mockResolvedValue({ success: true });

    renderScreen(onSessionChange);

    await user.click(await screen.findByRole("button", { name: "Log out" }));

    await waitFor(() => {
      expect(api.auth.logout).toHaveBeenCalledTimes(1);
      expect(onSessionChange).toHaveBeenCalledTimes(1);
      expect(navigateMock).toHaveBeenCalledWith("/login", { replace: true });
    });
  });
});
