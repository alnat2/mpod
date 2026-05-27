package episodes

import (
	"strings"
	"testing"
)

func TestSanitizeShowNotesPlainTextPreservesReadableBreaks(t *testing.T) {
	got := sanitizeShowNotes("First line\n\nSecond&nbsp;line")
	if got == nil {
		t.Fatal("expected sanitized show notes")
	}
	if *got != "First line\n\nSecond line" {
		t.Fatalf("unexpected plain text show notes %q", *got)
	}
}

func TestSanitizeShowNotesHTMLPreservesParagraphsLinksAndBreaks(t *testing.T) {
	got := sanitizeShowNotes(`<p>Hello&nbsp;world.</p><p>Read <a href="https://example.com/post">more</a><br>Thanks</p>`)
	if got == nil {
		t.Fatal("expected sanitized show notes")
	}
	want := "Hello world.\n\nRead more (https://example.com/post)\nThanks"
	if *got != want {
		t.Fatalf("unexpected html show notes\n got: %q\nwant: %q", *got, want)
	}
}

func TestSanitizeShowNotesHandlesMalformedHTML(t *testing.T) {
	got := sanitizeShowNotes(`<p>First <strong>bold<p>Second&nbsp;line`)
	if got == nil {
		t.Fatal("expected sanitized show notes")
	}
	if !strings.Contains(*got, "First bold") || !strings.Contains(*got, "Second line") {
		t.Fatalf("expected malformed html to stay readable, got %q", *got)
	}
	if strings.Contains(*got, "<p>") || strings.Contains(*got, "&nbsp;") {
		t.Fatalf("expected no raw html leftovers, got %q", *got)
	}
}

func TestSanitizeShowNotesKeepsLongLinkHeavyNotesReadable(t *testing.T) {
	got := sanitizeShowNotes(`<div><p>Resources:</p><ul><li><a href="https://example.com/a">Alpha</a></li><li><a href="https://example.com/b">Beta</a></li></ul><p>Visit&nbsp;<a href="https://example.com/c">Gamma</a> for more.</p></div>`)
	if got == nil {
		t.Fatal("expected sanitized show notes")
	}
	if !strings.Contains(*got, "Alpha (https://example.com/a)") {
		t.Fatalf("expected first link to be preserved, got %q", *got)
	}
	if !strings.Contains(*got, "Beta (https://example.com/b)") {
		t.Fatalf("expected second link to be preserved, got %q", *got)
	}
	if !strings.Contains(*got, "Visit Gamma (https://example.com/c) for more.") {
		t.Fatalf("expected inline link text to stay readable, got %q", *got)
	}
	if strings.Contains(*got, "<a") || strings.Contains(*got, "&nbsp;") {
		t.Fatalf("expected no raw html leftovers, got %q", *got)
	}
}
