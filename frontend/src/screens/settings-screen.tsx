import { useEffect, useState, type ReactNode } from "react";

import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";

import { AppShell, PageHeader } from "@/components/mpod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  api,
  type ProxyRuntimeStatus,
  type SchedulerStatus,
  type SettingsValues,
} from "@/lib/api";
import { useIsMobileViewport } from "@/lib/use-is-mobile-viewport";
import { useLatestRequest } from "@/lib/use-latest-request";

import { AddPodcastModal, type AddPodcastModalMode } from "./add-podcast-modal";
import { ErrorBanner, ScreenBannerStack } from "./screen-states";
import { getErrorMessage } from "./screen-utils";

type SettingsScreenProps = {
  onSessionChange?: () => void | Promise<void>;
};

function formatSchedulerRefresh(status: SchedulerStatus | null) {
  const lastRefreshAt =
    status?.lastRunAt ?? status?.lastSuccessAt ?? status?.lastFailureAt ?? null;

  if (!lastRefreshAt) {
    return "Last refresh never";
  }

  const refreshDate = new Date(lastRefreshAt);
  const now = new Date();
  const isSameDay =
    refreshDate.getFullYear() === now.getFullYear() &&
    refreshDate.getMonth() === now.getMonth() &&
    refreshDate.getDate() === now.getDate();

  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(refreshDate);

  if (isSameDay) {
    return `Last refresh today at ${timeLabel}`;
  }

  const dateLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(refreshDate);

  return `Last refresh ${dateLabel} at ${timeLabel}`;
}

function formatProxyIdentity(
  proxyConfigured: boolean,
  settings: SettingsValues | null,
  proxyStatus: ProxyRuntimeStatus | null
): ReactNode {
  if (!proxyConfigured) {
    return "Proxy runtime configuration is not available.";
  }

  if (!settings?.proxyEnabled || proxyStatus?.status === "off") {
    return "Proxy is off";
  }

  if (proxyStatus?.status === "ok") {
    if (proxyStatus.externalIp || proxyStatus.country) {
      return [
        proxyStatus.externalIp ? `Current IP: ${proxyStatus.externalIp}` : null,
        proxyStatus.country ? `Geo: ${proxyStatus.country}` : null,
      ]
        .filter(Boolean)
        .join(" • ");
    }
  }

  if (proxyStatus?.status === "error" && proxyStatus.error) {
    return proxyStatus.error;
  }

  return "Checking proxy status...";
}

type SettingsCardProps = {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
};

function SettingsCard({
  title,
  description,
  action,
  children,
  className,
}: SettingsCardProps) {
  return (
    <Card
      className={`w-full gap-0 rounded-md border border-border bg-card p-4 shadow-none ${className ?? ""}`}
    >
      <div className="flex w-full items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-6 font-semibold text-card-foreground">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        {action ? <div className="flex min-w-0 shrink-0 self-center">{action}</div> : null}
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </Card>
  );
}

export function SettingsScreen({ onSessionChange }: SettingsScreenProps) {
  const isMobile = useIsMobileViewport();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const [modal, setModal] = useState<AddPodcastModalMode>(null);
  const [settings, setSettings] = useState<SettingsValues | null>(null);
  const [proxyStatus, setProxyStatus] = useState<ProxyRuntimeStatus | null>(null);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [dailyRefreshTime, setDailyRefreshTime] = useState("03:00");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const statusPollRequests = useLatestRequest();
  const proxyConfigured = settings?.proxyConfigured || proxyStatus?.proxyConfigured || false;
  const settingsStatus = (
    <div
      className="flex flex-col"
      role={!loading ? "status" : undefined}
      aria-live={!loading ? "polite" : undefined}
      aria-atomic={!loading ? "true" : undefined}
    >
      <span>{formatSchedulerRefresh(scheduler)}</span>
      <span>{formatProxyIdentity(proxyConfigured, settings, proxyStatus)}</span>
    </div>
  );

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setLoading(true);
      setError(null);

      try {
        const [{ settings: values }, { scheduler: status }, { proxy }] = await Promise.all([
          api.settings.get(),
          api.jobs.status(),
          api.settings.proxyStatus(),
        ]);

        if (!cancelled) {
          setSettings(values);
          setProxyStatus(proxy);
          setDailyRefreshTime(values.dailyRefreshTime);
          setScheduler(status);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(getErrorMessage(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;

    async function refreshSchedulerStatus() {
      const requestGeneration = statusPollRequests.beginRequest();
      try {
        const [{ scheduler: status }, { proxy }] = await Promise.all([
          api.jobs.status(),
          api.settings.proxyStatus(),
        ]);
        if (
          !cancelled &&
          statusPollRequests.isLatestRequest(requestGeneration)
        ) {
          setScheduler(status);
          setProxyStatus(proxy);
        }
      } catch {
        // Keep the last known status visible instead of turning transient polling
        // failures into persistent screen errors.
      }
    }

    const interval = window.setInterval(() => {
      void refreshSchedulerStatus();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [reloadKey, statusPollRequests]);

  async function handleSaveRefreshTime() {
    setSaving(true);
    setActionError(null);

    try {
      const { settings: values } = await api.settings.update({
        dailyRefreshTime,
      });
      setSettings(values);
      setDailyRefreshTime(values.dailyRefreshTime);
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setActionError(getErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function handleProxyEnabledChange(proxyEnabled: boolean) {
    if (!proxyConfigured) {
      return;
    }

    setActionError(null);

    try {
      const { settings: values } = await api.settings.update({ proxyEnabled });
      setSettings(values);
      const { proxy } = await api.settings.proxyStatus();
      setProxyStatus(proxy);
    } catch (caught) {
      setActionError(getErrorMessage(caught));
    }
  }

  async function handleLogout() {
    setActionError(null);

    try {
      await api.auth.logout();
      await onSessionChange?.();
      navigate("/login", { replace: true });
    } catch (caught) {
      setActionError(getErrorMessage(caught));
    }
  }

  return (
    <>
      <AppShell
        activeNavItem="Settings"
        mainClassName="xl:max-w-[1280px]"
        onAddPodcast={() => setModal("rss")}
        pageTitle="Settings"
        pageSubtitle=""
        pageActions={[]}
        pageHeaderVisible={false}
      >
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background md:rounded-md md:border md:border-border md:bg-card md:px-10 md:py-5">
          {isMobile ? (
            <div className="pt-4">
              <PageHeader
                layout="mobile"
                title="Settings"
                subtitle={settingsStatus}
                actions={[]}
              />
            </div>
          ) : (
            <PageHeader
              layout="desktop"
              title="Settings"
              subtitle={settingsStatus}
              actions={[]}
            />
          )}
          <ScreenBannerStack>
            {error ? (
              <ErrorBanner onClose={() => setError(null)}>{error}</ErrorBanner>
            ) : null}
            {actionError ? (
              <ErrorBanner onClose={() => setActionError(null)}>
                {actionError}
              </ErrorBanner>
            ) : null}
          </ScreenBannerStack>
          <div className="mpod-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-4 pb-20 md:py-6">
            <div className="flex w-full flex-col gap-4">
              <div className="grid gap-4 min-[1360px]:grid-cols-[1fr_680px] min-[1360px]:gap-6">
                <SettingsCard
                  title="Feed daily refresh"
                  description="Feeds are refreshed once per day at a single global time."
                  className="min-[1360px]:min-h-[168px]"
                >
                  <div className="flex w-full items-center gap-2 min-[1360px]:w-[220px]">
                    <Input
                      type="time"
                      aria-label="Daily refresh time"
                      value={dailyRefreshTime}
                      disabled={loading || saving}
                      className="h-9 rounded-md px-3 text-base"
                      onChange={(event) => setDailyRefreshTime(event.target.value)}
                    />
                    <Button
                      type="button"
                      className="h-9 w-[116px] rounded-lg px-4 min-[1360px]:w-auto"
                      disabled={saving || loading}
                      onClick={() => void handleSaveRefreshTime()}
                    >
                      Save time
                    </Button>
                  </div>
                </SettingsCard>

                <div className="grid gap-4 min-[1360px]:grid-cols-2">
                  <SettingsCard
                    title="Use SOCKS5 proxy"
                    description="Turn on if direct connection update fails."
                    action={
                      <Switch
                        aria-label="Use SOCKS5 proxy"
                        size="lg"
                        checked={settings?.proxyEnabled ?? false}
                        disabled={!proxyConfigured}
                        onCheckedChange={(checked) =>
                          void handleProxyEnabledChange(checked)
                        }
                      />
                    }
                  />

                  <SettingsCard
                    title="Use dark theme"
                    description="Use this option if it feels more comfortable for you."
                    action={
                      <Switch
                        aria-label="Use dark theme"
                        size="lg"
                        checked={resolvedTheme === "dark"}
                        onCheckedChange={(checked) =>
                          setTheme(checked ? "dark" : "light")
                        }
                      />
                    }
                  />

                  <SettingsCard
                    title="Export OPML"
                    description="Download the current subscription list as an OPML file."
                    action={
                      <Button
                        asChild
                        type="button"
                        className="h-9 w-[115px] rounded-md px-3"
                      >
                        <a href={api.podcasts.exportOPMLPath}>Export OPML</a>
                      </Button>
                    }
                  />

                  <SettingsCard
                    title="Session"
                    description="End the current browser session"
                    action={
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 w-[113px] rounded-md px-3"
                        onClick={() => void handleLogout()}
                      >
                        Log out
                      </Button>
                    }
                  />
                </div>
              </div>
              {settings?.appBuild ? (
                <div className="mt-8 text-sm font-medium text-secondary-foreground">
                  Current app build: {settings.appBuild}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </AppShell>
      <AddPodcastModal
        mode={modal}
        onClose={() => setModal(null)}
        onModeChange={setModal}
      />
    </>
  );
}
