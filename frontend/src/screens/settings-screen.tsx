import { useEffect, useState } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  CalendarSyncIcon,
  FileExportIcon,
  FolderSyncIcon,
  Logout03Icon,
} from "@hugeicons/core-free-icons";
import { useNavigate } from "react-router-dom";

import { AppShell, SettingItem } from "@/components/mpod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  api,
  type SchedulerStatus,
  type SettingsValues,
} from "@/lib/api";

import { AddPodcastModal, type AddPodcastModalMode } from "./add-podcast-modal";
import { ErrorBanner } from "./screen-states";
import { formatDateTime, getErrorMessage } from "./screen-utils";

type SettingsScreenProps = {
  onSessionChange?: () => void | Promise<void>;
};

export function SettingsScreen({ onSessionChange }: SettingsScreenProps) {
  const navigate = useNavigate();
  const [modal, setModal] = useState<AddPodcastModalMode>(null);
  const [settings, setSettings] = useState<SettingsValues | null>(null);
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
        const [{ settings: values }, { scheduler: status }] = await Promise.all([
          api.settings.get(),
          api.jobs.status(),
        ]);

        if (!cancelled) {
          setSettings(values);
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
        pageSubtitle="Manage import, refresh, proxy, and session settings."
        pageActions={[]}
      >
        <div className="flex h-full min-h-[686px] w-full overflow-y-auto rounded-lg py-6">
          <div className="flex w-full max-w-[760px] flex-col gap-4">
            {error ? (
              <ErrorBanner>{error}</ErrorBanner>
            ) : null}
            {actionError ? (
              <ErrorBanner>{actionError}</ErrorBanner>
            ) : null}

            <SettingItem
              title="OPML export"
              description="Export current podcast subscriptions as an OPML file."
              action={
                <Button asChild type="button" variant="secondary">
                  <a href={api.podcasts.exportOPMLPath}>
                    <HugeiconsIcon
                      icon={FileExportIcon}
                      data-icon="inline-start"
                    />
                    Export OPML
                  </a>
                </Button>
              }
            />

            <SettingItem
              title="Daily refresh"
              description="The scheduler refreshes all subscriptions once per day."
              action={
                <Button
                  type="button"
                  disabled={saving || loading}
                  onClick={() => void handleSaveRefreshTime()}
                >
                  <HugeiconsIcon icon={FolderSyncIcon} data-icon="inline-start" />
                  Save
                </Button>
              }
            >
              <label className="flex w-full max-w-72 flex-col gap-2 text-sm leading-5 font-medium text-card-foreground">
                Refresh time
                <Input
                  type="time"
                  value={dailyRefreshTime}
                  disabled={loading || saving}
                  onChange={(event) => setDailyRefreshTime(event.target.value)}
                />
              </label>
            </SettingItem>

            <SettingItem
              title="Scheduler status"
              description="Refresh status from the backend scheduler."
              action={
                <Badge variant="secondary">
                  {scheduler?.state ?? (loading ? "Loading" : "Idle")}
                </Badge>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
                  <HugeiconsIcon
                    icon={CalendarSyncIcon}
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">Daily time</span>
                  <span className="ml-auto text-card-foreground">
                    {settings?.dailyRefreshTime ?? dailyRefreshTime}
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
                  <HugeiconsIcon
                    icon={CalendarSyncIcon}
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">Last success</span>
                  <span className="ml-auto text-card-foreground">
                    {formatDateTime(scheduler?.lastSuccessAt)}
                  </span>
                </div>
              </div>
            </SettingItem>

            <SettingItem
              title="SOCKS5 proxy"
              description={
                settings?.proxyConfigured
                  ? "Use configured proxy settings for feed and media requests."
                  : "Proxy runtime configuration is not available."
              }
              action={
                <Switch
                  aria-label="Use SOCKS5 proxy"
                  checked={settings?.proxyEnabled ?? false}
                  disabled={!settings?.proxyConfigured}
                  onCheckedChange={(checked) =>
                    void handleProxyEnabledChange(checked)
                  }
                />
              }
            >
              <div className="flex items-center gap-2 text-sm leading-5">
                <Badge variant="secondary">
                  {settings?.proxyConfigured ? "Configured" : "Not configured"}
                </Badge>
                <span className="text-muted-foreground">
                  Host, port, username, and password stay in runtime config.
                </span>
              </div>
            </SettingItem>

            <SettingItem
              title="Session"
              description="End the current browser session."
              action={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleLogout()}
                >
                  <HugeiconsIcon icon={Logout03Icon} data-icon="inline-start" />
                  Logout
                </Button>
              }
            />
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
