// Package render fills {{dotted.path}} placeholders from a value.
//
// It is the same placeholder syntax Relaywave uses for SMS templates, so a
// template can be previewed locally before it is configured on the gateway.
package render

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

var placeholder = regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}`)

// MissingError reports a placeholder with no value.
type MissingError struct{ Path string }

func (e MissingError) Error() string { return "no value for {{" + e.Path + "}}" }

// Render resolves every placeholder in tmpl against vars. vars may be any
// value that encodes to a JSON object; paths follow the JSON field names.
func Render(tmpl string, vars any) (string, error) {
	raw, err := json.Marshal(vars)
	if err != nil {
		return "", err
	}
	var tree map[string]any
	if err := json.Unmarshal(raw, &tree); err != nil {
		return "", fmt.Errorf("vars must be a JSON object: %w", err)
	}
	var missing error
	out := placeholder.ReplaceAllStringFunc(tmpl, func(m string) string {
		path := placeholder.FindStringSubmatch(m)[1]
		value, ok := lookup(tree, path)
		if !ok {
			if missing == nil {
				missing = MissingError{Path: path}
			}
			return m
		}
		return value
	})
	return out, missing
}

func lookup(tree map[string]any, path string) (string, bool) {
	var node any = tree
	for _, part := range strings.Split(path, ".") {
		obj, ok := node.(map[string]any)
		if !ok {
			return "", false
		}
		if node, ok = obj[part]; !ok {
			return "", false
		}
	}
	switch v := node.(type) {
	case string:
		return v, true
	case float64, bool:
		return fmt.Sprint(v), true
	default:
		return "", false
	}
}
