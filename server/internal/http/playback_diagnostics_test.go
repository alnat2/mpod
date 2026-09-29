package http

import (
	"bytes"
	"log"
	nethttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPlaybackCompletionRequestLogIncludesTraceAndHTTPStatus(t *testing.T) {
	var output bytes.Buffer
	router := &Router{logger: log.New(&output, "", 0)}
	handler := router.recoverAndLog(nethttp.HandlerFunc(func(w nethttp.ResponseWriter, _ *nethttp.Request) {
		w.WriteHeader(nethttp.StatusInternalServerError)
	}))
	req := httptest.NewRequest(nethttp.MethodPost, "/api/playback", nil)
	req.Header.Set("X-Playback-Trace-ID", "trace-123")
	handler.ServeHTTP(httptest.NewRecorder(), req)
	if !strings.Contains(output.String(), `playback_trace server trace="trace-123" status=500`) {
		t.Fatalf("completion status was not correlated: %s", output.String())
	}
}

func TestPlaybackDiagnosticsAcceptsBoundedAuthenticatedEvents(t *testing.T) {
	handler, _ := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	body := `{"events":[{"id":"event-123","traceId":"trace-123","at":"2026-09-28T09:32:04Z","event":"completion_error","audiobookId":10,"trackId":20,"code":"NETWORK_OR_CLIENT_ERROR"},{"id":"event-124","traceId":"trace-123","at":"2026-09-28T09:32:05Z","event":"play_attempt","audiobookId":10,"trackId":21,"sourceGeneration":2,"mediaReadyState":0,"documentHidden":true,"positionSeconds":0},{"id":"event-125","traceId":"trace-123","at":"2026-09-28T09:32:06Z","event":"play_result","audiobookId":10,"trackId":21,"mediaReadyState":4,"documentHidden":false,"positionSeconds":1,"code":"RESOLVED"}]}`
	req := httptest.NewRequest(nethttp.MethodPost, "/api/playback/diagnostics", bytes.NewBufferString(body))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != nethttp.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestPlaybackDiagnosticsRequiresAuthAndRejectsUnboundedInput(t *testing.T) {
	handler, _ := newTestRouter(t)
	body := `{"events":[{"id":"event-123","traceId":"trace-123","at":"2026-09-28T09:32:04Z","event":"ended"}]}`
	unauthorized := httptest.NewRequest(nethttp.MethodPost, "/api/playback/diagnostics", strings.NewReader(body))
	unauthorizedRec := httptest.NewRecorder()
	handler.ServeHTTP(unauthorizedRec, unauthorized)
	if unauthorizedRec.Code != nethttp.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", unauthorizedRec.Code)
	}

	cookie := register(t, handler, "admin", "secret")
	tooLargeBody := `{"events":[],"padding":"` + strings.Repeat("x", 17<<10) + `"}`
	tooLarge := httptest.NewRequest(nethttp.MethodPost, "/api/playback/diagnostics", strings.NewReader(tooLargeBody))
	tooLarge.AddCookie(cookie)
	tooLargeRec := httptest.NewRecorder()
	handler.ServeHTTP(tooLargeRec, tooLarge)
	if tooLargeRec.Code != nethttp.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d body=%s", tooLargeRec.Code, tooLargeRec.Body.String())
	}
}
