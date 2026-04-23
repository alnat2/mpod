package config

import "testing"

func TestLoadAppliesDefaultsAndEnv(t *testing.T) {
	t.Setenv("SESSION_SECRET", "secret")
	t.Setenv("PORT", "9090")
	t.Setenv("TZ", "Europe/Moscow")
	t.Setenv("DATA_DIR", "/custom/data")
	t.Setenv("DB_PATH", "/custom/data/db.sqlite")
	t.Setenv("DOWNLOADS_DIR", "/custom/data/downloads")
	t.Setenv("DAILY_REFRESH_TIME", "09:15")
	t.Setenv("APP_ENV", "development")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Port != "9090" || cfg.TZ != "Europe/Moscow" || cfg.DBPath != "/custom/data/db.sqlite" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if cfg.DailyRefreshTime != "09:15" {
		t.Fatalf("expected daily refresh time 09:15, got %q", cfg.DailyRefreshTime)
	}
}

func TestLoadRequiresSessionSecret(t *testing.T) {
	t.Setenv("SESSION_SECRET", "")

	if _, err := Load(); err == nil {
		t.Fatalf("expected SESSION_SECRET validation error")
	}
}

func TestLoadRejectsPlaceholderSecretInProduction(t *testing.T) {
	t.Setenv("SESSION_SECRET", "change-me")
	t.Setenv("APP_ENV", "production")

	if _, err := Load(); err == nil {
		t.Fatalf("expected placeholder secret rejection in production")
	}
}

func TestLoadRequiresSocksHostAndPortTogether(t *testing.T) {
	t.Setenv("SESSION_SECRET", "secret")
	t.Setenv("SOCKS5_HOST", "127.0.0.1")
	t.Setenv("SOCKS5_PORT", "")

	if _, err := Load(); err == nil {
		t.Fatalf("expected SOCKS5 host/port validation error")
	}
}

func TestDSNFormatsFilePath(t *testing.T) {
	cfg := Config{DBPath: "/data/mpod.sqlite"}
	if got := cfg.DSN(); got != "file:/data/mpod.sqlite" {
		t.Fatalf("unexpected DSN %q", got)
	}
}
