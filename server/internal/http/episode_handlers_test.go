package http

import (
	"bytes"
	"context"
	"io"
	nethttp "net/http"
	"testing"
	"time"
)

func TestStreamBytesPerSecondUsesBitrateHeadroomAndMinimum(t *testing.T) {
	if got := streamBytesPerSecond(16_000*60, 60); got != minimumStreamRate {
		t.Fatalf("expected minimum stream rate %d, got %d", minimumStreamRate, got)
	}
	if got := streamBytesPerSecond(100_000*60, 60); got != 150_000 {
		t.Fatalf("expected bitrate headroom rate 150000, got %d", got)
	}
	if got := streamBytesPerSecond(0, 60); got != 0 {
		t.Fatalf("expected unknown size to disable pacing, got %d", got)
	}
	if got := streamBytesPerSecond(1_000_000, 0); got != 0 {
		t.Fatalf("expected unknown duration to disable pacing, got %d", got)
	}
}

func TestResponseTotalLengthUsesFullContentRangeSize(t *testing.T) {
	resp := &nethttp.Response{
		ContentLength: 10,
		Header:        nethttp.Header{"Content-Range": []string{"bytes 10-19/100"}},
	}
	if got := responseTotalLength(resp); got != 100 {
		t.Fatalf("expected full content length 100, got %d", got)
	}
}

func TestPacedReaderAllowsBurstThenWaits(t *testing.T) {
	startedAt := time.Date(2026, 8, 12, 9, 0, 0, 0, time.UTC)
	reader := &pacedReader{
		ctx:            context.Background(),
		reader:         bytes.NewReader(make([]byte, 30)),
		bytesPerSecond: 10,
		burstBytes:     20,
		startedAt:      startedAt,
		now:            func() time.Time { return startedAt },
	}
	var waited time.Duration
	reader.wait = func(_ context.Context, delay time.Duration) error {
		waited += delay
		return nil
	}

	if _, err := io.CopyBuffer(io.Discard, reader, make([]byte, 10)); err != nil {
		t.Fatalf("paced copy failed: %v", err)
	}
	if waited != time.Second {
		t.Fatalf("expected one second pacing delay after burst, got %s", waited)
	}
}
