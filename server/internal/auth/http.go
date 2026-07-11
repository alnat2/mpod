package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"
)

func SetSessionCookie(w http.ResponseWriter, sessionID, secret string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    signedSessionValue(sessionID, secret),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
		MaxAge:   int((30 * 24 * time.Hour).Seconds()),
	})
}

func ClearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
		MaxAge:   -1,
	})
}

func SessionIDFromRequest(r *http.Request, secret string) string {
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		return ""
	}
	sessionID, ok := verifySignedSessionValue(cookie.Value, secret)
	if !ok {
		return ""
	}
	return sessionID
}

func SessionCookieSecure(r *http.Request) bool {
	if r == nil {
		return false
	}

	if r.TLS != nil {
		return true
	}

	if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https") {
		return true
	}

	for _, part := range strings.Split(r.Header.Get("Forwarded"), ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok && strings.EqualFold(key, "proto") && strings.EqualFold(strings.Trim(value, "\""), "https") {
			return true
		}
	}

	return false
}

func signedSessionValue(sessionID, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(sessionID))
	return sessionID + "." + hex.EncodeToString(mac.Sum(nil))
}

func verifySignedSessionValue(value, secret string) (string, bool) {
	sessionID, signature, ok := strings.Cut(value, ".")
	if !ok || sessionID == "" || signature == "" {
		return "", false
	}

	expected := signedSessionValue(sessionID, secret)
	if !hmac.Equal([]byte(expected), []byte(value)) {
		return "", false
	}
	return sessionID, true
}
