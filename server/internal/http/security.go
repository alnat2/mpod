package http

import (
	nethttp "net/http"
	"net/url"
	"strings"
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

	scheme := requestScheme(req)
	if !strings.EqualFold(origin.Scheme, scheme) {
		return false
	}

	return strings.EqualFold(
		normalizeHost(origin.Host, origin.Scheme),
		normalizeHost(requestHost(req), scheme),
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

func requestHost(req *nethttp.Request) string {
	for _, part := range strings.Split(req.Header.Get("Forwarded"), ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok && strings.EqualFold(key, "host") {
			val := strings.Trim(strings.TrimSpace(value), "\"")
			if val != "" {
				return val
			}
		}
	}

	if forwardedHost := strings.TrimSpace(req.Header.Get("X-Forwarded-Host")); forwardedHost != "" {
		if firstHost, _, ok := strings.Cut(forwardedHost, ","); ok {
			return strings.TrimSpace(firstHost)
		}
		return forwardedHost
	}

	return req.Host
}

func requestScheme(req *nethttp.Request) string {
	if req.TLS != nil {
		return "https"
	}
	if strings.EqualFold(strings.TrimSpace(req.Header.Get("X-Forwarded-Proto")), "https") {
		return "https"
	}
	for _, part := range strings.Split(req.Header.Get("Forwarded"), ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok && strings.EqualFold(key, "proto") && strings.EqualFold(strings.Trim(strings.TrimSpace(value), "\""), "https") {
			return "https"
		}
	}
	return "http"
}
