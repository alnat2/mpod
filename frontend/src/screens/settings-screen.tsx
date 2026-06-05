import { useEffect, useState, type ReactNode } from "react";

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
    return `Status: ${status?.state ?? "idle"} · last refresh never`;
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
    return `Status: ${status?.state ?? "idle"} · last refresh today at ${timeLabel}`;
  }

  const dateLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(refreshDate);

  return `Status: ${status?.state ?? "idle"} · last refresh ${dateLabel} at ${timeLabel}`;
}

function formatProxyDescription(
  settings: SettingsValues | null,
  proxyStatus: ProxyRuntimeStatus | null
) {
  if (!settings?.proxyConfigured) {
    return "Proxy runtime configuration is not available.";
  }

  if (!settings.proxyEnabled || proxyStatus?.status === "off") {
    return "Proxy is off";
  }

  if (proxyStatus?.status === "ok") {
    const parts: string[] = [];

    if (proxyStatus.externalIp) {
      parts.push(`Current IP: ${proxyStatus.externalIp}`);
    }

    if (proxyStatus.country) {
      parts.push(`Geo: ${proxyStatus.country}`);
    }

    if (parts.length > 0) {
      return parts.join(" • ");
    }
  }

  if (proxyStatus?.status === "error" && proxyStatus.error) {
    return "Proxy status unavailable";
  }

  return "Checking proxy status...";
}

type SettingsCardProps = {
  title: string;
  description: string;
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
      className={`w-full rounded-md border border-border bg-card p-4 shadow-none ${className ?? ""}`}
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
        {action ? <div className="flex min-w-0 shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </Card>
  );
}

export function SettingsScreen({ onSessionChange }: SettingsScreenProps) {
  const isMobile = useIsMobileViewport();
  const navigate = useNavigate();
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
      try {
        const [{ scheduler: status }, { proxy }] = await Promise.all([
          api.jobs.status(),
          api.settings.proxyStatus(),
        ]);
        if (!cancelled) {
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
  }, [reloadKey]);

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
    if (!settings?.proxyConfigured) {
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
        onAddPodcast={() => setModal("rss")}
        pageTitle="Settings"
        pageSubtitle=""
        pageActions={[]}
        pageHeaderVisible={false}
      >
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background md:rounded-md md:border md:border-border md:bg-card md:px-10 md:py-5">
          {isMobile ? (
            <div className="pt-4">
              <PageHeader layout="mobile" title="Settings" actions={[]} />
            </div>
          ) : (
            <div className="flex w-full items-center gap-6">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                <h1 className="truncate text-3xl leading-9 font-semibold text-foreground">
                  Settings
                </h1>
              </div>
            </div>
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
              <div className="grid gap-4 md:gap-6 lg:grid-cols-[1fr_420px]">
                <SettingsCard
                  title="Feed daily refresh"
                  description="Feeds are refreshed once per day at a single global time."
                  className="md:min-h-[193px]"
                >
                  <div className="flex w-full items-center gap-2 md:w-[220px]">
                    <Input
                      type="time"
                      value={dailyRefreshTime}
                      disabled={loading || saving}
                      className="h-9 rounded-md px-3 text-base"
                      onChange={(event) => setDailyRefreshTime(event.target.value)}
                    />
                    <Button
                      type="button"
                      className="h-9 rounded-lg px-4"
                      disabled={saving || loading}
                      onClick={() => void handleSaveRefreshTime()}
                    >
                      Save time
                    </Button>
                  </div>
                  <p className="mt-4 text-sm leading-5 font-medium text-secondary-foreground">
                    {formatSchedulerRefresh(scheduler)}
                  </p>
                </SettingsCard>

                <div className="flex flex-col gap-4">
                  <SettingsCard
                    title="Use SOCKS5 proxy"
                    description={formatProxyDescription(settings, proxyStatus)}
                    action={
                      <Switch
                        aria-label="Use SOCKS5 proxy"
                        size="lg"
                        checked={settings?.proxyEnabled ?? false}
                        disabled={!settings?.proxyConfigured}
                        onCheckedChange={(checked) =>
                          void handleProxyEnabledChange(checked)
                        }
                      />
                    }
                  />

                  <SettingsCard
                    title="Export OPML"
                    description="Download the current subscription list as an OPML file."
                    action={
                      <Button asChild type="button" className="h-8 rounded-md px-3">
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
                        className="h-8 rounded-md px-3"
                        onClick={() => void handleLogout()}
                      >
                        Log out
                      </Button>
                    }
                  />
                </div>
              </div>
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
