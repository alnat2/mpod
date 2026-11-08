package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/cross/mpod/server/internal/httputil"
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
	return r != nil && httputil.RequestScheme(r) == "https"
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
