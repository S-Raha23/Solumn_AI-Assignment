// Package notify posts JSON documents to the systems the clinic group talks to.
package notify

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Destination is a configured endpoint.
type Destination struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Operator string `json:"operator"`
}

// Destinations known to this service. The names are what callers pass to Send.
var Destinations = map[string]Destination{
	"ehr": {Name: "ehr", URL: "https://ehr.lindenfield.internal/api/appointments/batch", Operator: "Lindenfield clinical records (self-hosted)"},
	"sms": {Name: "sms", URL: "https://api.relaywave.example/v3/messages", Operator: "Relaywave Ltd, SMS gateway"},
}

// DeliveryError means the destination did not accept the document.
type DeliveryError struct {
	Destination string
	Reason      string
}

func (e DeliveryError) Error() string { return e.Destination + ": " + e.Reason }

// Client sends documents. With no network in this image every document is
// written, exactly as it would be posted, to <Root>/<destination>/NNNNN.json.
type Client struct {
	Root string
	Now  func() time.Time
}

// NewClient uses $OUTBOX_ROOT (default /var/tmp/outbox).
func NewClient() *Client {
	root := os.Getenv("OUTBOX_ROOT")
	if root == "" {
		root = "/var/tmp/outbox"
	}
	return &Client{Root: root, Now: time.Now}
}

func failing(name string) bool {
	for _, n := range strings.Split(os.Getenv("OUTBOX_FAIL"), ",") {
		if strings.TrimSpace(n) == name {
			return true
		}
	}
	return false
}

// Send posts body as JSON to the named destination.
func (c *Client) Send(name string, body any) error {
	dest, ok := Destinations[name]
	if !ok {
		return fmt.Errorf("unknown destination %q", name)
	}
	if failing(name) {
		return DeliveryError{Destination: name, Reason: "503 service unavailable"}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	dir := filepath.Join(c.Root, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	entries, _ := os.ReadDir(dir)
	record := map[string]any{
		"destination": name,
		"url":         dest.URL,
		"sent_at":     c.Now().UTC().Format(time.RFC3339),
		"body":        json.RawMessage(payload),
	}
	out, _ := json.MarshalIndent(record, "", "  ")
	return os.WriteFile(filepath.Join(dir, fmt.Sprintf("%05d.json", len(entries)+1)), append(out, '\n'), 0o644)
}
