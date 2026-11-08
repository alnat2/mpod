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

func parseRFC7239Forwarded(header string) (proto string, host string) {
	if header == "" {
		return "", ""
	}

	firstHop, _, _ := strings.Cut(header, ",")
	for _, part := range strings.Split(firstHop, ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		val := strings.Trim(strings.TrimSpace(value), "\"")
		if strings.EqualFold(key, "proto") && proto == "" {
			proto = val
		} else if strings.EqualFold(key, "host") && host == "" {
			host = val
		}
	}
	return proto, host
}

func requestHost(req *nethttp.Request) string {
	if _, host := parseRFC7239Forwarded(req.Header.Get("Forwarded")); host != "" {
		return host
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
	if proto, _ := parseRFC7239Forwarded(req.Header.Get("Forwarded")); proto != "" {
		if strings.EqualFold(proto, "https") {
			return "https"
		}
		return "http"
	}
	if strings.EqualFold(strings.TrimSpace(req.Header.Get("X-Forwarded-Proto")), "https") {
		return "https"
	}
	return "http"
}
