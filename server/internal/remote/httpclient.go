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
	return NewHTTPClientWithProxyDecider(cfg, nil)
}

func NewHTTPClientWithProxyDecider(cfg config.Config, proxyEnabled func(context.Context) bool) (*http.Client, error) {
	directTransport := http.DefaultTransport.(*http.Transport).Clone()
	if cfg.SOCKS5Host == "" {
		return newClientWithRoundTrippers(directTransport, nil, proxyEnabled), nil
	}

	proxyTransport := directTransport.Clone()
	dialer, err := proxy.SOCKS5("tcp", net.JoinHostPort(cfg.SOCKS5Host, cfg.SOCKS5Port), credentials(cfg), proxy.Direct)
	if err != nil {
		return nil, fmt.Errorf("create socks5 dialer: %w", err)
	}
	proxyTransport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		return dialer.Dial(network, addr)
	}

	return newClientWithRoundTrippers(directTransport, proxyTransport, proxyEnabled), nil
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

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (fn roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func newClientWithRoundTrippers(direct, proxy http.RoundTripper, proxyEnabled func(context.Context) bool) *http.Client {
	transport := direct
	if proxy != nil {
		transport = proxy
	}

	if proxy != nil && proxyEnabled != nil {
		transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			if proxyEnabled(req.Context()) {
				return proxy.RoundTrip(req)
			}
			return direct.RoundTrip(req)
		})
	}

	return &http.Client{
		Timeout:   30 * time.Second,
		Transport: transport,
	}
}
