package config

import (
	"errors"
	"fmt"
	"os"
)

type Config struct {
	Port             string
	TZ               string
	SessionSecret    string
	DataDir          string
	DBPath           string
	DownloadsDir     string
	DailyRefreshTime string
	SOCKS5Host       string
	SOCKS5Port       string
	SOCKS5Username   string
	SOCKS5Password   string
	Environment      string
}

func Load() (Config, error) {
	cfg := Config{
		Port:             envOrDefault("PORT", "5050"),
		TZ:               envOrDefault("TZ", "UTC"),
		SessionSecret:    os.Getenv("SESSION_SECRET"),
		DataDir:          envOrDefault("DATA_DIR", "/data"),
		DBPath:           envOrDefault("DB_PATH", "/data/mpod.sqlite"),
		DownloadsDir:     envOrDefault("DOWNLOADS_DIR", "/data/downloads"),
		DailyRefreshTime: envOrDefault("DAILY_REFRESH_TIME", "03:00"),
		SOCKS5Host:       os.Getenv("SOCKS5_HOST"),
		SOCKS5Port:       os.Getenv("SOCKS5_PORT"),
		SOCKS5Username:   os.Getenv("SOCKS5_USERNAME"),
		SOCKS5Password:   os.Getenv("SOCKS5_PASSWORD"),
		Environment:      envOrDefault("APP_ENV", "development"),
	}

	if cfg.SessionSecret == "" {
		return Config{}, errors.New("SESSION_SECRET is required")
	}
	if cfg.Environment == "production" && cfg.SessionSecret == "change-me" {
		return Config{}, errors.New("SESSION_SECRET cannot use placeholder value in production")
	}
	if (cfg.SOCKS5Host == "") != (cfg.SOCKS5Port == "") {
		return Config{}, errors.New("SOCKS5_HOST and SOCKS5_PORT must be provided together")
	}

	return cfg, nil
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func (c Config) DSN() string {
	return fmt.Sprintf("file:%s", c.DBPath)
}
