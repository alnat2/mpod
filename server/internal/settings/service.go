package settings

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalidSettingsUpdate   = errors.New("no settings provided")
	ErrInvalidDailyRefreshTime = errors.New("invalid daily refresh time")
	ErrProxyNotConfigured      = errors.New("proxy is not configured")
)

type Service struct {
	db              *sql.DB
	proxyConfigured bool
	proxyLookup     ProxyStatusLookup
}

type Values struct {
	DailyRefreshTime string `json:"dailyRefreshTime"`
	ProxyEnabled     bool   `json:"proxyEnabled"`
	ProxyConfigured  bool   `json:"proxyConfigured"`
}

type ProxyStatus struct {
	ProxyEnabled    bool    `json:"proxyEnabled"`
	ProxyConfigured bool    `json:"proxyConfigured"`
	Status          string  `json:"status"`
	ExternalIP      *string `json:"externalIp"`
	Country         *string `json:"country"`
	Error           *string `json:"error"`
}

type ProxyLookupResult struct {
	ExternalIP string
	Country    string
}

type ProxyStatusLookup func(context.Context) (ProxyLookupResult, error)

const (
	ProxyStatusOff     = "off"
	ProxyStatusOK      = "ok"
	ProxyStatusUnknown = "unknown"
	ProxyStatusError   = "error"
)

type UpdateInput struct {
	DailyRefreshTime *string `json:"dailyRefreshTime"`
	ProxyEnabled     *bool   `json:"proxyEnabled"`
}

func NewService(db *sql.DB, proxyConfigured bool) *Service {
	return NewServiceWithProxyStatusLookup(db, proxyConfigured, nil)
}

func NewServiceWithProxyStatusLookup(db *sql.DB, proxyConfigured bool, proxyLookup ProxyStatusLookup) *Service {
	return &Service{
		db:              db,
		proxyConfigured: proxyConfigured,
		proxyLookup:     proxyLookup,
	}
}

func (s *Service) Get(ctx context.Context) (Values, error) {
	var values Values
	if err := s.db.QueryRowContext(ctx, `
		SELECT value
		FROM settings
		WHERE key = 'daily_refresh_time'
	`).Scan(&values.DailyRefreshTime); err != nil {
		return Values{}, fmt.Errorf("load settings: %w", err)
	}
	enabled, err := s.ProxyEnabled(ctx)
	if err != nil {
		return Values{}, err
	}
	values.ProxyEnabled = enabled
	values.ProxyConfigured = s.proxyConfigured
	return values, nil
}

func (s *Service) ProxyEnabled(ctx context.Context) (bool, error) {
	return s.loadProxyEnabled(ctx)
}

func (s *Service) GetProxyStatus(ctx context.Context) (ProxyStatus, error) {
	enabled, err := s.loadProxyEnabled(ctx)
	if err != nil {
		return ProxyStatus{}, err
	}

	status := ProxyStatus{
		ProxyEnabled:    enabled,
		ProxyConfigured: s.proxyConfigured,
	}

	if !enabled {
		status.Status = ProxyStatusOff
		return status, nil
	}

	if !s.proxyConfigured {
		status.Status = ProxyStatusUnknown
		message := "Proxy runtime configuration is unavailable"
		status.Error = &message
		return status, nil
	}

	if s.proxyLookup == nil {
		status.Status = ProxyStatusUnknown
		message := "Proxy status lookup is unavailable"
		status.Error = &message
		return status, nil
	}

	result, err := s.proxyLookup(ctx)
	if err != nil {
		status.Status = ProxyStatusError
		message := err.Error()
		status.Error = &message
		return status, nil
	}

	if strings.TrimSpace(result.ExternalIP) == "" && strings.TrimSpace(result.Country) == "" {
		status.Status = ProxyStatusUnknown
		message := "Proxy status check returned no observable network identity"
		status.Error = &message
		return status, nil
	}

	status.Status = ProxyStatusOK
	if strings.TrimSpace(result.ExternalIP) != "" {
		externalIP := strings.TrimSpace(result.ExternalIP)
		status.ExternalIP = &externalIP
	}
	if strings.TrimSpace(result.Country) != "" {
		country := strings.TrimSpace(result.Country)
		status.Country = &country
	}
	return status, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Values, error) {
	if input.DailyRefreshTime == nil && input.ProxyEnabled == nil {
		return Values{}, ErrInvalidSettingsUpdate
	}
	if input.DailyRefreshTime != nil {
		if _, err := time.Parse("15:04", strings.TrimSpace(*input.DailyRefreshTime)); err != nil {
			return Values{}, ErrInvalidDailyRefreshTime
		}
	}
	if input.ProxyEnabled != nil && *input.ProxyEnabled && !s.proxyConfigured {
		return Values{}, ErrProxyNotConfigured
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Values{}, fmt.Errorf("begin settings update tx: %w", err)
	}
	defer tx.Rollback()

	if input.DailyRefreshTime != nil {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO settings (key, value)
			VALUES ('daily_refresh_time', ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value
		`, strings.TrimSpace(*input.DailyRefreshTime)); err != nil {
			return Values{}, fmt.Errorf("update daily refresh time: %w", err)
		}
	}
	if input.ProxyEnabled != nil {
		value := "0"
		if *input.ProxyEnabled {
			value = "1"
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO settings (key, value)
			VALUES ('proxy_enabled', ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value
		`, value); err != nil {
			return Values{}, fmt.Errorf("update proxy enabled: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return Values{}, fmt.Errorf("commit settings update: %w", err)
	}

	return s.Get(ctx)
}

func (s *Service) loadProxyEnabled(ctx context.Context) (bool, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, `
		SELECT value
		FROM settings
		WHERE key = 'proxy_enabled'
	`).Scan(&raw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("load proxy enabled: %w", err)
	}
	return raw == "1" || strings.EqualFold(raw, "true"), nil
}
