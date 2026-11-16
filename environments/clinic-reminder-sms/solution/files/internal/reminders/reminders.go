// Package reminders sends the day-before SMS reminder for booked appointments.
package reminders

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"lindenfield.example/clinicops/internal/notify"
	"lindenfield.example/clinicops/internal/render"
	"lindenfield.example/clinicops/internal/schedule"
	"lindenfield.example/clinicops/internal/store"
)

const (
	window     = 24 * time.Hour
	quietUntil = 8  // local hour sends may start
	quietFrom  = 21 // local hour sends must stop
)

// ErrSomeFailed is returned when at least one message could not be sent.
var ErrSomeFailed = errors.New("one or more reminders failed")

// Message is the Relaywave request body.
type Message struct {
	To        string         `json:"to"`
	Template  string         `json:"template"`
	Vars      map[string]any `json:"vars"`
	Reference string         `json:"reference"`
}

type template struct {
	Name string `json:"name"`
	Body string `json:"body"`
}

func loadTemplates(dir string) (map[string]string, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "sms_templates.json"))
	if err != nil {
		return nil, err
	}
	var list []template
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, t := range list {
		out[t.Name] = t.Body
	}
	return out, nil
}

// sentKey identifies one reminder: an appointment at one start time.
func sentKey(a store.Appointment) string {
	return a.ID + "@" + a.StartsAt.UTC().Format(time.RFC3339)
}

func loadSent(path string) (map[string]string, error) {
	sent := map[string]string{}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return sent, nil
	}
	if err != nil {
		return nil, err
	}
	return sent, json.Unmarshal(raw, &sent)
}

func saveSent(path string, sent map[string]string) error {
	raw, _ := json.MarshalIndent(sent, "", "  ")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func quiet(now time.Time, clinic store.Clinic) bool {
	h := now.In(clinic.Location()).Hour()
	return h < quietUntil || h >= quietFrom
}

// records is everything a template could refer to for one appointment.
func records(s *store.Store, a store.Appointment) map[string]any {
	clinic := s.Clinics[a.ClinicID]
	return map[string]any{
		"patient":   s.Patients[a.PatientID],
		"clinician": s.Clinicians[a.ClinicianID],
		"clinic":    clinic,
		"appointment": map[string]any{
			"id": a.ID, "kind": a.Kind, "minutes": a.Minutes,
			"starts_at": a.StartsAt.UTC().Format(time.RFC3339), "starts_local": schedule.StartsLocal(a, clinic),
		},
	}
}

var placeholderRE = regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}`)

// placeholders lists the dotted paths a template uses, in order of first use.
func placeholders(body string) []string {
	var out []string
	seen := map[string]bool{}
	for _, m := range placeholderRE.FindAllStringSubmatch(body, -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			out = append(out, m[1])
		}
	}
	return out
}

// varsFor returns only the values the template uses, nested by path. The
// gateway is a third party and gets nothing beyond what the text needs.
func varsFor(body string, all map[string]any) (map[string]any, error) {
	raw, _ := json.Marshal(all)
	var tree map[string]any
	_ = json.Unmarshal(raw, &tree)
	vars := map[string]any{}
	for _, path := range placeholders(body) {
		parts := strings.Split(path, ".")
		var node any = tree
		for _, p := range parts {
			obj, ok := node.(map[string]any)
			if !ok {
				return nil, render.MissingError{Path: path}
			}
			if node, ok = obj[p]; !ok {
				return nil, render.MissingError{Path: path}
			}
		}
		dst := vars
		for _, p := range parts[:len(parts)-1] {
			next, ok := dst[p].(map[string]any)
			if !ok {
				next = map[string]any{}
				dst[p] = next
			}
			dst = next
		}
		dst[parts[len(parts)-1]] = node
	}
	if _, err := render.Render(body, vars); err != nil {
		return nil, err
	}
	return vars, nil
}

// Run sends every reminder that is due at now. It returns the ids reminded,
// in start order, and ErrSomeFailed if any send failed.
func Run(s *store.Store, client *notify.Client, now time.Time) ([]string, error) {
	templates, err := loadTemplates(s.Dir)
	if err != nil {
		return nil, err
	}
	sentPath := filepath.Join(s.Dir, "reminders_sent.json")
	sent, err := loadSent(sentPath)
	if err != nil {
		return nil, err
	}
	var reminded []string
	failed := false
	for _, a := range schedule.Between(s, now, now.Add(window)) {
		patient, clinic := s.Patients[a.PatientID], s.Clinics[a.ClinicID]
		if !patient.Contact.SMS || patient.Phone == "" || quiet(now, clinic) {
			continue
		}
		if _, done := sent[sentKey(a)]; done {
			continue
		}
		body, ok := templates[clinic.SMSTemplate]
		if !ok {
			failed = true
			continue
		}
		vars, err := varsFor(body, records(s, a))
		if err != nil {
			failed = true
			continue
		}
		msg := Message{To: patient.Phone, Template: clinic.SMSTemplate, Vars: vars, Reference: "appt-" + a.ID}
		if err := client.Send("sms", msg); err != nil {
			failed = true
			continue
		}
		sent[sentKey(a)] = now.UTC().Format(time.RFC3339)
		reminded = append(reminded, a.ID)
	}
	if err := saveSent(sentPath, sent); err != nil {
		return reminded, err
	}
	if failed {
		return reminded, ErrSomeFailed
	}
	return reminded, nil
}

// Describe is used in error messages.
func Describe(err error) string { return fmt.Sprint(err) }
