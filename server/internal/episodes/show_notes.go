package episodes

import (
	"html"
	"strings"
	"unicode"

	nethtml "golang.org/x/net/html"
)

func sanitizeShowNotes(raw string) *string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}

	if !strings.Contains(raw, "<") {
		text := normalizeShowNotesText(html.UnescapeString(raw))
		if text == "" {
			return nil
		}
		return &text
	}

	doc, err := nethtml.Parse(strings.NewReader("<div>" + raw + "</div>"))
	if err != nil {
		text := normalizeShowNotesText(html.UnescapeString(raw))
		if text == "" {
			return nil
		}
		return &text
	}

	root := findFirstElement(doc, "div")
	if root == nil {
		text := normalizeShowNotesText(html.UnescapeString(raw))
		if text == "" {
			return nil
		}
		return &text
	}

	var builder strings.Builder
	for child := root.FirstChild; child != nil; child = child.NextSibling {
		renderShowNotesNode(&builder, child)
	}

	text := normalizeShowNotesText(builder.String())
	if text == "" {
		return nil
	}
	return &text
}

// SanitizeShowNotes converts feed-provided show notes into safe plain text for API responses.
func SanitizeShowNotes(raw string) *string {
	return sanitizeShowNotes(raw)
}

func renderShowNotesNode(builder *strings.Builder, node *nethtml.Node) {
	switch node.Type {
	case nethtml.TextNode:
		builder.WriteString(node.Data)
	case nethtml.ElementNode:
		tag := strings.ToLower(node.Data)
		switch tag {
		case "br":
			builder.WriteString("\n")
		case "p", "div", "section", "article", "header", "footer", "aside", "blockquote",
			"h1", "h2", "h3", "h4", "h5", "h6":
			builder.WriteString("\n\n")
			renderShowNotesChildren(builder, node)
			builder.WriteString("\n\n")
		case "ul", "ol":
			builder.WriteString("\n\n")
			renderShowNotesChildren(builder, node)
			builder.WriteString("\n")
		case "li":
			builder.WriteString("\n- ")
			renderShowNotesChildren(builder, node)
			builder.WriteString("\n")
		case "a":
			text := normalizeShowNotesText(renderInlineNode(node))
			href := strings.TrimSpace(nodeAttr(node, "href"))
			switch {
			case text == "" && href != "":
				builder.WriteString(href)
			case href == "" || href == text:
				builder.WriteString(text)
			case text != "":
				builder.WriteString(text)
				builder.WriteString(" (")
				builder.WriteString(href)
				builder.WriteString(")")
			}
		default:
			renderShowNotesChildren(builder, node)
		}
	}
}

func renderShowNotesChildren(builder *strings.Builder, node *nethtml.Node) {
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		renderShowNotesNode(builder, child)
	}
}

func renderInlineNode(node *nethtml.Node) string {
	var builder strings.Builder
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		renderShowNotesNode(&builder, child)
	}
	return builder.String()
}

func nodeAttr(node *nethtml.Node, key string) string {
	for _, attr := range node.Attr {
		if strings.EqualFold(attr.Key, key) {
			return attr.Val
		}
	}
	return ""
}

func findFirstElement(node *nethtml.Node, tag string) *nethtml.Node {
	if node.Type == nethtml.ElementNode && strings.EqualFold(node.Data, tag) {
		return node
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if found := findFirstElement(child, tag); found != nil {
			return found
		}
	}
	return nil
}

func normalizeShowNotesText(raw string) string {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	raw = strings.ReplaceAll(raw, "\r", "\n")
	raw = strings.ReplaceAll(raw, "\u00a0", " ")

	lines := strings.Split(raw, "\n")
	normalized := make([]string, 0, len(lines))
	previousBlank := false
	for _, line := range lines {
		text := collapseShowNotesWhitespace(line)
		if text == "" {
			if previousBlank {
				continue
			}
			normalized = append(normalized, "")
			previousBlank = true
			continue
		}
		normalized = append(normalized, text)
		previousBlank = false
	}

	return strings.TrimSpace(strings.Join(normalized, "\n"))
}

func collapseShowNotesWhitespace(raw string) string {
	var builder strings.Builder
	lastWasSpace := false
	for _, r := range raw {
		if unicode.IsSpace(r) {
			if builder.Len() > 0 {
				lastWasSpace = true
			}
			continue
		}
		if lastWasSpace && builder.Len() > 0 {
			builder.WriteByte(' ')
		}
		builder.WriteRune(r)
		lastWasSpace = false
	}
	return strings.TrimSpace(builder.String())
}
