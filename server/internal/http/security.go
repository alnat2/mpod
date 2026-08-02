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

	return strings.EqualFold(origin.Scheme, requestScheme(req)) &&
		strings.EqualFold(origin.Host, req.Host)
}

func requestScheme(req *nethttp.Request) string {
	if req.TLS != nil {
		return "https"
	}
	if strings.EqualFold(strings.TrimSpace(req.Header.Get("X-Forwarded-Proto")), "https") {
		return "https"
	}
	return "http"
}
