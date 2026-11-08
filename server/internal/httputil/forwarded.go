package httputil

import (
	"net/http"
	"strings"
)

// ParseRFC7239Forwarded parses the first hop of an RFC 7239 Forwarded header.
// It returns the client's proto and host directives, with quotes and surrounding whitespace stripped.
func ParseRFC7239Forwarded(header string) (proto string, host string) {
	if header == "" {
		return "", ""
	}

	firstHop, _, _ := strings.Cut(header, ",")
	for _, part := range strings.Split(firstHop, ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		k := strings.TrimSpace(key)
		val := strings.Trim(strings.TrimSpace(value), "\"")
		if strings.EqualFold(k, "proto") && proto == "" {
			proto = val
		} else if strings.EqualFold(k, "host") && host == "" {
			host = val
		}
	}
	return proto, host
}

// RequestScheme determines whether the request originated via HTTPS or HTTP.
// Resolution priority:
// 1. Direct TLS connection
// 2. RFC 7239 Forwarded header (proto directive of first hop)
// 3. X-Forwarded-Proto header
// 4. Default "http"
func RequestScheme(req *http.Request) string {
	if req == nil {
		return "http"
	}
	if req.TLS != nil {
		return "https"
	}
	if proto, _ := ParseRFC7239Forwarded(req.Header.Get("Forwarded")); proto != "" {
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

// RequestHost determines the effective host requested by the client.
// Resolution priority:
// 1. RFC 7239 Forwarded header (host directive of first hop)
// 2. X-Forwarded-Host header (first hop if comma-separated)
// 3. req.Host
func RequestHost(req *http.Request) string {
	if req == nil {
		return ""
	}
	if _, host := ParseRFC7239Forwarded(req.Header.Get("Forwarded")); host != "" {
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
