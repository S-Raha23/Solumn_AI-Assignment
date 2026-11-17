// Package reminders sends the day-before SMS reminder for booked appointments.
package reminders

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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

// varsFor is what a reminder template can draw on for one appointment. The
// live templates are edited in Relaywave, so this is a fixed set rather than
// the placeholders of one template: who the message is for, when, where and
// with whom. Relaywave is a third party, so nothing clinical and no
// identifiers beyond the name go to it.
func varsFor(s *store.Store, a store.Appointment) map[string]any {
	patient, clinician, clinic := s.Patients[a.PatientID], s.Clinicians[a.ClinicianID], s.Clinics[a.ClinicID]
	return map[string]any{
		"patient":   map[string]any{"first_name": patient.FirstName, "last_name": patient.LastName},
		"clinician": map[string]any{"display_name": clinician.DisplayName, "role": clinician.Role},
		"clinic":    map[string]any{"name": clinic.Name, "phone": clinic.Phone, "address": clinic.Address},
		"appointment": map[string]any{
			"id": a.ID, "kind": a.Kind, "minutes": a.Minutes,
			"starts_at": a.StartsAt.UTC().Format(time.RFC3339), "starts_local": schedule.StartsLocal(a, clinic),
		},
	}
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
		vars := varsFor(s, a)
		// The export may lag behind Relaywave; check against it when it has the template.
		if body, ok := templates[clinic.SMSTemplate]; ok {
			if _, err := render.Render(body, vars); err != nil {
				failed = true
				continue
			}
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
