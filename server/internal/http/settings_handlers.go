package http

import (
	"context"
	"encoding/json"
	"fmt"
	nethttp "net/http"
	"strings"

	"github.com/cross/mpod/server/internal/settings"
)

func (r *Router) handleSettingsGet(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	values, err := r.settings.Get(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "SETTINGS_LOAD_FAILED", "Failed to load settings")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"settings": values,
	})
}

func (r *Router) handleSettingsPatch(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	var payload struct {
		DailyRefreshTime       *string `json:"dailyRefreshTime"`
		PlaybackSpeed          *string `json:"playbackSpeed"`
		AudiobookPlaybackSpeed *string `json:"audiobookPlaybackSpeed"`
		ProxyEnabled           *bool   `json:"proxyEnabled"`
	}
	if !r.decodeJSON(w, req, &payload) {
		return
	}

	values, err := r.settings.Update(req.Context(), settings.UpdateInput{
		DailyRefreshTime:       payload.DailyRefreshTime,
		PlaybackSpeed:          payload.PlaybackSpeed,
		AudiobookPlaybackSpeed: payload.AudiobookPlaybackSpeed,
		ProxyEnabled:           payload.ProxyEnabled,
	})
	if err != nil {
		switch err {
		case settings.ErrInvalidSettingsUpdate:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_SETTINGS", "At least one settings field must be provided")
		case settings.ErrInvalidDailyRefreshTime:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_SETTINGS", "dailyRefreshTime must use HH:MM format")
		case settings.ErrInvalidPlaybackSpeed:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_SETTINGS", "playbackSpeed must use an approved speed label")
		case settings.ErrProxyNotConfigured:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_SETTINGS", "Proxy cannot be enabled without runtime configuration")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "SETTINGS_UPDATE_FAILED", "Failed to update settings")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"settings": values,
	})
}

func (r *Router) handleProxyStatus(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	status, err := r.settings.GetProxyStatus(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PROXY_STATUS_FAILED", "Failed to load proxy status")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"proxy": status,
	})
}

func fetchObservedProxyStatus(ctx context.Context, client *nethttp.Client) (settings.ProxyLookupResult, error) {
	req, err := nethttp.NewRequestWithContext(ctx, nethttp.MethodGet, "https://ipwho.is/", nil)
	if err != nil {
		return settings.ProxyLookupResult{}, fmt.Errorf("build proxy status request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return settings.ProxyLookupResult{}, fmt.Errorf("request proxy status: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != nethttp.StatusOK {
		return settings.ProxyLookupResult{}, fmt.Errorf("request proxy status: unexpected status %d", resp.StatusCode)
	}

	var payload struct {
		Success bool   `json:"success"`
		IP      string `json:"ip"`
		Country string `json:"country"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return settings.ProxyLookupResult{}, fmt.Errorf("decode proxy status: %w", err)
	}
	if !payload.Success {
		if strings.TrimSpace(payload.Message) != "" {
			return settings.ProxyLookupResult{}, fmt.Errorf("request proxy status: %s", strings.TrimSpace(payload.Message))
		}
		return settings.ProxyLookupResult{}, fmt.Errorf("request proxy status: external identity lookup failed")
	}

	return settings.ProxyLookupResult{
		ExternalIP: payload.IP,
		Country:    payload.Country,
	}, nil
}
