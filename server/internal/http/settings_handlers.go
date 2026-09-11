package http

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	nethttp "net/http"
	"strings"
	"time"

	"github.com/cross/mpod/server/internal/settings"
)

var (
	proxyLookupMaxAttempts = 2
	proxyLookupRetryDelay  = 200 * time.Millisecond
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

const proxyLookupUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

type proxyLookupEndpoint struct {
	url   string
	parse func(body io.Reader) (settings.ProxyLookupResult, error)
}

var defaultProxyLookupEndpoints = []proxyLookupEndpoint{
	{
		url: "https://www.cloudflare.com/cdn-cgi/trace",
		parse: func(body io.Reader) (settings.ProxyLookupResult, error) {
			scanner := bufio.NewScanner(body)
			var ip, loc string
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if strings.HasPrefix(line, "ip=") {
					ip = strings.TrimSpace(strings.TrimPrefix(line, "ip="))
				} else if strings.HasPrefix(line, "loc=") {
					loc = strings.TrimSpace(strings.TrimPrefix(line, "loc="))
				}
			}
			if ip == "" {
				return settings.ProxyLookupResult{}, errors.New("empty IP returned")
			}
			return settings.ProxyLookupResult{
				ExternalIP: ip,
				Country:    loc,
			}, nil
		},
	},
	{
		url: "https://ipwho.is/",
		parse: func(body io.Reader) (settings.ProxyLookupResult, error) {
			var payload struct {
				Success bool   `json:"success"`
				IP      string `json:"ip"`
				Country string `json:"country"`
				Message string `json:"message"`
			}
			if err := json.NewDecoder(body).Decode(&payload); err != nil {
				return settings.ProxyLookupResult{}, fmt.Errorf("decode: %w", err)
			}
			if !payload.Success {
				msg := strings.TrimSpace(payload.Message)
				if msg != "" {
					return settings.ProxyLookupResult{}, errors.New(msg)
				}
				return settings.ProxyLookupResult{}, errors.New("external identity lookup failed")
			}
			return settings.ProxyLookupResult{
				ExternalIP: strings.TrimSpace(payload.IP),
				Country:    strings.TrimSpace(payload.Country),
			}, nil
		},
	},
	{
		url: "https://ifconfig.co/json",
		parse: func(body io.Reader) (settings.ProxyLookupResult, error) {
			var payload struct {
				IP      string `json:"ip"`
				Country string `json:"country"`
			}
			if err := json.NewDecoder(body).Decode(&payload); err != nil {
				return settings.ProxyLookupResult{}, fmt.Errorf("decode: %w", err)
			}
			if strings.TrimSpace(payload.IP) == "" {
				return settings.ProxyLookupResult{}, errors.New("empty IP returned")
			}
			return settings.ProxyLookupResult{
				ExternalIP: strings.TrimSpace(payload.IP),
				Country:    strings.TrimSpace(payload.Country),
			}, nil
		},
	},
	{
		url: "https://api.ipify.org?format=json",
		parse: func(body io.Reader) (settings.ProxyLookupResult, error) {
			var payload struct {
				IP string `json:"ip"`
			}
			if err := json.NewDecoder(body).Decode(&payload); err != nil {
				return settings.ProxyLookupResult{}, fmt.Errorf("decode: %w", err)
			}
			if strings.TrimSpace(payload.IP) == "" {
				return settings.ProxyLookupResult{}, errors.New("empty IP returned")
			}
			return settings.ProxyLookupResult{
				ExternalIP: strings.TrimSpace(payload.IP),
			}, nil
		},
	},
}

func fetchObservedProxyStatus(ctx context.Context, client *nethttp.Client) (settings.ProxyLookupResult, error) {
	var lastErr error

	for _, endpoint := range defaultProxyLookupEndpoints {
		for attempt := 1; attempt <= proxyLookupMaxAttempts; attempt++ {
			if attempt > 1 {
				select {
				case <-ctx.Done():
					return settings.ProxyLookupResult{}, ctx.Err()
				case <-time.After(proxyLookupRetryDelay):
				}
			}

			req, err := nethttp.NewRequestWithContext(ctx, nethttp.MethodGet, endpoint.url, nil)
			if err != nil {
				lastErr = fmt.Errorf("build proxy status request: %w", err)
				break
			}
			req.Header.Set("Accept", "application/json")
			req.Header.Set("User-Agent", proxyLookupUserAgent)

			resp, err := client.Do(req)
			if err != nil {
				lastErr = err
				continue
			}

			if resp.StatusCode >= 500 {
				_ = resp.Body.Close()
				lastErr = fmt.Errorf("remote server returned status %d", resp.StatusCode)
				continue
			}

			if resp.StatusCode != nethttp.StatusOK {
				_ = resp.Body.Close()
				lastErr = fmt.Errorf("unexpected status %d", resp.StatusCode)
				break
			}

			result, parseErr := endpoint.parse(resp.Body)
			_ = resp.Body.Close()
			if parseErr != nil {
				lastErr = parseErr
				continue
			}

			if result.ExternalIP != "" {
				return result, nil
			}
		}
	}

	if errors.Is(lastErr, io.EOF) || strings.Contains(lastErr.Error(), "EOF") {
		return settings.ProxyLookupResult{}, fmt.Errorf("request proxy status: connection closed unexpectedly (EOF)")
	}
	return settings.ProxyLookupResult{}, fmt.Errorf("request proxy status: %w", lastErr)
}
