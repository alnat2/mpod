package remote

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

var ErrOutboundURLNotAllowed = errors.New("outbound URL is not allowed")

// ValidateHTTPURL applies the shared policy for backend HTTP fetches.
func ValidateHTTPURL(target *url.URL) error {
	if target == nil {
		return fmt.Errorf("%w: URL is missing", ErrOutboundURLNotAllowed)
	}

	scheme := strings.ToLower(strings.TrimSpace(target.Scheme))
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("%w: only http and https schemes are supported", ErrOutboundURLNotAllowed)
	}
	if target.Opaque != "" || target.Host == "" || target.Hostname() == "" {
		return fmt.Errorf("%w: URL host is missing", ErrOutboundURLNotAllowed)
	}
	if target.User != nil {
		return fmt.Errorf("%w: URL credentials are not supported", ErrOutboundURLNotAllowed)
	}
	return nil
}

type policyRoundTripper struct {
	next http.RoundTripper
}

func (t policyRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if req == nil {
		return nil, fmt.Errorf("%w: request is missing", ErrOutboundURLNotAllowed)
	}
	if err := ValidateHTTPURL(req.URL); err != nil {
		return nil, err
	}
	return t.next.RoundTrip(req)
}
