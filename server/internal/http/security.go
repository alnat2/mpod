package http

import (
	nethttp "net/http"
	"net/url"
	"strings"

	"github.com/cross/mpod/server/internal/httputil"
)

const contentSecurityPolicy = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; form-action 'self'"

func (r *Router) securityHeaders(next nethttp.Handler) nethttp.Handler {
	return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, req *nethttp.Request) {
		w.Header().Set("Content-Security-Policy", contentSecurityPolicy)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		next.ServeHTTP(w, req)
	})
}

func (r *Router) requireSameOrigin(next nethttp.Handler) nethttp.Handler {
	return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, req *nethttp.Request) {
		if !isStateChangingAPIRequest(req) || requestOriginMatches(req) {
			next.ServeHTTP(w, req)
			return
		}

		r.writeAPIError(
			w,
			nethttp.StatusForbidden,
			"CROSS_ORIGIN_REQUEST",
			"Cross-origin state-changing requests are not allowed",
		)
	})
}

func isStateChangingAPIRequest(req *nethttp.Request) bool {
	if !strings.HasPrefix(req.URL.Path, "/api/") {
		return false
	}

	switch req.Method {
	case nethttp.MethodPost, nethttp.MethodPut, nethttp.MethodPatch, nethttp.MethodDelete:
		return true
	default:
		return false
	}
}

func requestOriginMatches(req *nethttp.Request) bool {
	rawOrigin := strings.TrimSpace(req.Header.Get("Origin"))
	if rawOrigin == "" {
		return true
	}

	origin, err := url.Parse(rawOrigin)
	if err != nil || origin.Scheme == "" || origin.Host == "" || origin.User != nil {
		return false
	}
	if origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
		return false
	}

	scheme := httputil.RequestScheme(req)
	if !strings.EqualFold(origin.Scheme, scheme) {
		return false
	}

	return strings.EqualFold(
		normalizeHost(origin.Host, origin.Scheme),
		normalizeHost(httputil.RequestHost(req), scheme),
	)
}

func normalizeHost(host, scheme string) string {
	host = strings.TrimSpace(host)
	if scheme == "https" && strings.HasSuffix(host, ":443") {
		return strings.TrimSuffix(host, ":443")
	}
	if scheme == "http" && strings.HasSuffix(host, ":80") {
		return strings.TrimSuffix(host, ":80")
	}
	return host
}
