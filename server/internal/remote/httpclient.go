package remote

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/cross/mpod/server/internal/config"
	"golang.org/x/net/proxy"
)

func NewHTTPClient(cfg config.Config) (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()

	if cfg.SOCKS5Host != "" {
		dialer, err := proxy.SOCKS5("tcp", net.JoinHostPort(cfg.SOCKS5Host, cfg.SOCKS5Port), credentials(cfg), proxy.Direct)
		if err != nil {
			return nil, fmt.Errorf("create socks5 dialer: %w", err)
		}

		transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			return dialer.Dial(network, addr)
		}
	}

	return &http.Client{
		Timeout:   30 * time.Second,
		Transport: transport,
	}, nil
}

func credentials(cfg config.Config) *proxy.Auth {
	if cfg.SOCKS5Username == "" {
		return nil
	}
	return &proxy.Auth{
		User:     cfg.SOCKS5Username,
		Password: cfg.SOCKS5Password,
	}
}
