export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export type User = {
  id: number;
  username: string;
};

export type AuthSession = {
  authenticated: boolean;
  user: User | null;
  setupRequired: boolean;
};

export type Podcast = {
  id: number;
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  rssUrl: string;
  lastChecked: string | null;
  updateTime: string | null;
};

export type Episode = {
  id: number;
  podcastId: number;
  title: string;
  description?: string | null;
  showNotes?: string | null;
  audioUrl: string;
  duration: number | null;
  downloaded: boolean;
  isListened: boolean;
  publishedAt: string | null;
};

export type PlaylistItem = {
  episodeId: number;
  position: number;
  episode: {
    id: number;
    title: string;
    podcastId: number;
    isListened: boolean;
    downloaded: boolean;
  };
};

export type PlaybackState = {
  episodeId: number;
  positionSeconds: number;
  lastUpdated: string;
};

export type SettingsValues = {
  dailyRefreshTime: string;
  playbackSpeed: string;
  proxyEnabled: boolean;
  proxyConfigured: boolean;
};

export type ProxyRuntimeStatus = {
  proxyEnabled: boolean;
  proxyConfigured: boolean;
  status: string;
  externalIp: string | null;
  country: string | null;
  error: string | null;
};

type MaybeArray<T> = T[] | null;

export type SchedulerStatus = {
  state: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt?: string | null;
  lastError?: string | null;
};

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) {
      throw new ApiError(response.statusText, "HTTP_ERROR", response.status);
    }
    return undefined as T;
  }

  const data = (await response.json()) as T | ApiErrorBody;
  if (!response.ok) {
    const error = (data as ApiErrorBody).error;
    throw new ApiError(
      error?.message ?? response.statusText,
      error?.code ?? "HTTP_ERROR",
      response.status
    );
  }

  return data as T;
}

async function apiRequest<T>(path: string, options: RequestOptions = {}) {
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;

  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(path, {
    ...options,
    body,
    cache:
      options.cache ??
      (options.method === undefined || options.method === "GET"
        ? "no-store"
        : undefined),
    credentials: "same-origin",
    headers,
  });

  return parseResponse<T>(response);
}

export const api = {
  auth: {
    session: () => apiRequest<AuthSession>("/api/auth/session"),
    register: (payload: { username: string; password: string }) =>
      apiRequest<{ user: User }>("/api/auth/register", {
        method: "POST",
        body: payload,
      }),
    login: (payload: { username: string; password: string }) =>
      apiRequest<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: payload,
      }),
    logout: () =>
      apiRequest<{ success: true }>("/api/auth/logout", { method: "POST" }),
  },
   podcasts: {
     list: () => apiRequest<{ podcasts: MaybeArray<Podcast> }>("/api/podcasts"),
     imagePath: (podcastId: number) => `/api/podcasts/${podcastId}/image`,
     create: (rssUrl: string) =>
       apiRequest<{ podcast: Podcast }>("/api/podcasts", {
         method: "POST",
         body: { rssUrl },
       }),
     remove: (podcastId: number) =>
       apiRequest<{ success: true }>(`/api/podcasts/${podcastId}`, {
         method: "DELETE",
       }),
     refresh: (podcastId: number) =>
       apiRequest<{ success: true; newEpisodes: number; lastChecked: string }>(
         `/api/podcasts/${podcastId}/refresh`,
         { method: "POST" }
       ),
     refreshAll: () =>
       apiRequest<{ success: true }>("/api/podcasts/refresh-all", {
         method: "POST"
       }),
     episodes: (podcastId: number) =>
       apiRequest<{ episodes: MaybeArray<Episode> }>(
         `/api/podcasts/${podcastId}/episodes`
       ),
     importOPML: (file: File) => {
       const body = new FormData();
       body.append("file", file);
       return apiRequest<{ success: true; imported: number; skipped: number }>(
         "/api/podcasts/import-opml",
         { method: "POST", body }
       );
     },
     exportOPMLPath: "/api/podcasts/export-opml",
   },
  episodes: {
    get: (episodeId: number) =>
      apiRequest<{ episode: Episode }>(`/api/episodes/${episodeId}`),
    setListened: (episodeId: number, isListened: boolean) =>
      apiRequest<{ episode: Pick<Episode, "id" | "isListened"> }>(
        `/api/episodes/${episodeId}`,
        { method: "PATCH", body: { isListened } }
      ),
    download: (episodeId: number) =>
      apiRequest<{ success: true; episode: Partial<Episode> }>(
        `/api/episodes/${episodeId}/download`,
        { method: "POST" }
      ),
  },
  playlist: {
    list: () => apiRequest<{ items: MaybeArray<PlaylistItem> }>("/api/playlist"),
    add: (episodeId: number) =>
      apiRequest<{ success: true }>("/api/playlist", {
        method: "POST",
        body: { episodeId },
      }),
    remove: (episodeId: number) =>
      apiRequest<{ success: true }>(`/api/playlist/${episodeId}`, {
        method: "DELETE",
      }),
    reorder: (episodeIds: number[]) =>
      apiRequest<{ success: true }>("/api/playlist/reorder", {
        method: "PATCH",
        body: { episodeIds },
      }),
  },
  playback: {
    get: (episodeId: number) =>
      apiRequest<{ playback: PlaybackState | null }>(
        `/api/playback/${episodeId}`
      ),
    update: (payload: {
      episodeId: number;
      positionSeconds: number;
      durationSeconds?: number;
      completed?: boolean;
      didSeek?: boolean;
      clientUpdatedAt?: string;
    }) =>
      apiRequest<{ playback: PlaybackState }>("/api/playback", {
        method: "POST",
        body: {
          durationSeconds: 0,
          completed: false,
          didSeek: false,
          ...payload,
        },
      }),
  },
  settings: {
    get: () => apiRequest<{ settings: SettingsValues }>("/api/settings"),
    proxyStatus: () =>
      apiRequest<{ proxy: ProxyRuntimeStatus }>("/api/proxy/status"),
    update: (payload: {
      dailyRefreshTime?: string;
      playbackSpeed?: string;
      proxyEnabled?: boolean;
    }) =>
      apiRequest<{ settings: SettingsValues }>("/api/settings", {
        method: "PATCH",
        body: payload,
      }),
  },
  jobs: {
    status: () =>
      apiRequest<{ scheduler: SchedulerStatus }>("/api/jobs/status"),
  },
};
