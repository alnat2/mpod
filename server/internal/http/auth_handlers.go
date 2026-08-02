package http

import (
	nethttp "net/http"

	"github.com/cross/mpod/server/internal/auth"
)

func (r *Router) handleSession(w nethttp.ResponseWriter, req *nethttp.Request) {
	count, err := r.auth.UserCount(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "SESSION_CHECK_FAILED", "Failed to load session state")
		return
	}

	user, err := r.auth.CurrentUser(req.Context(), auth.SessionIDFromRequest(req, r.config.SessionSecret))
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "SESSION_CHECK_FAILED", "Failed to load session state")
		return
	}

	authenticated := user != nil
	var payloadUser any
	if authenticated {
		payloadUser = user
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"authenticated": authenticated,
		"user":          payloadUser,
		"setupRequired": count == 0,
	})
}

func (r *Router) handleRegister(w nethttp.ResponseWriter, req *nethttp.Request) {
	var payload struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if !r.decodeJSON(w, req, &payload) {
		return
	}

	user, sessionID, err := r.auth.RegisterInitial(req.Context(), payload.Username, payload.Password)
	if err != nil {
		switch err {
		case auth.ErrInvalidRegistration:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_REGISTRATION", "Username and password are required")
		case auth.ErrSetupDisabled:
			r.writeAPIError(w, nethttp.StatusBadRequest, "SETUP_ALREADY_COMPLETE", "Initial registration is no longer available")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "REGISTER_FAILED", "Failed to create initial user")
		}
		return
	}

	auth.SetSessionCookie(w, sessionID, r.config.SessionSecret, auth.SessionCookieSecure(req))
	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"user": user,
	})
}

func (r *Router) handleLogin(w nethttp.ResponseWriter, req *nethttp.Request) {
	var payload struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if !r.decodeJSON(w, req, &payload) {
		return
	}

	user, sessionID, err := r.auth.Login(req.Context(), payload.Username, payload.Password)
	if err != nil {
		switch err {
		case auth.ErrInvalidCredentials:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_CREDENTIALS", "Username or password is incorrect")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "LOGIN_FAILED", "Failed to log in")
		}
		return
	}

	auth.SetSessionCookie(w, sessionID, r.config.SessionSecret, auth.SessionCookieSecure(req))
	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"user": user,
	})
}

func (r *Router) handleLogout(w nethttp.ResponseWriter, req *nethttp.Request) {
	if err := r.auth.Logout(req.Context(), auth.SessionIDFromRequest(req, r.config.SessionSecret)); err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "LOGOUT_FAILED", "Failed to log out")
		return
	}

	auth.ClearSessionCookie(w, auth.SessionCookieSecure(req))
	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"success": true,
	})
}
