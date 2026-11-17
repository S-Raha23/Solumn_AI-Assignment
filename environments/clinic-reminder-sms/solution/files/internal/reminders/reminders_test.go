package reminders

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"lindenfield.example/clinicops/internal/notify"
	"lindenfield.example/clinicops/internal/store"
)

func fixture(t *testing.T) (*store.Store, *notify.Client, string) {
	t.Helper()
	dir := t.TempDir()
	for _, name := range []string{"patients.json", "clinicians.json", "clinics.json", "appointments.json", "sms_templates.json"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "data", name))
		if err != nil {
			t.Fatal(err)
		}
		_ = os.WriteFile(filepath.Join(dir, name), raw, 0o644)
	}
	s, err := store.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	outbox := t.TempDir()
	return s, &notify.Client{Root: outbox, Now: time.Now}, outbox
}

func messages(t *testing.T, outbox string) []Message {
	entries, _ := os.ReadDir(filepath.Join(outbox, "sms"))
	var out []Message
	for _, e := range entries {
		raw, _ := os.ReadFile(filepath.Join(outbox, "sms", e.Name()))
		var doc struct{ Body Message }
		_ = json.Unmarshal(raw, &doc)
		out = append(out, doc.Body)
	}
	return out
}

func TestRemindersRespectWindowConsentAndQuietHours(t *testing.T) {
	s, client, outbox := fixture(t)
	early := time.Date(2026, 11, 16, 7, 0, 0, 0, time.UTC)
	got, err := Run(s, client, early)
	if err != nil || len(got) != 0 {
		t.Fatalf("quiet hours: got %v %v", got, err)
	}
	now := time.Date(2026, 11, 16, 9, 30, 0, 0, time.UTC)
	got, err = Run(s, client, now)
	if err != nil {
		t.Fatal(err)
	}
	// ap-506 (09:00 cork) and ap-501 (09:30) are in the window; ap-502 at 10:00 is not yet.
	if len(got) != 2 || got[0] != "ap-506" || got[1] != "ap-501" {
		t.Fatalf("got %v", got)
	}
	msgs := messages(t, outbox)
	if msgs[1].Template != "reminder_standard" || msgs[1].To != "+447700900311" || msgs[1].Reference != "appt-ap-501" {
		t.Fatalf("bad message %+v", msgs[1])
	}
	again, _ := Run(s, client, now.Add(15*time.Minute))
	if len(again) != 0 {
		t.Fatalf("sent twice: %v", again)
	}
}

func TestVarsCarryTheNameButNothingClinical(t *testing.T) {
	s, client, outbox := fixture(t)
	if _, err := Run(s, client, time.Date(2026, 11, 16, 9, 30, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	vars := messages(t, outbox)[1].Vars
	patient := vars["patient"].(map[string]any)
	if len(patient) != 2 || patient["first_name"] != "Eleanor" || patient["last_name"] != "Pike" {
		t.Fatalf("patient vars %v", patient)
	}
	if vars["appointment"].(map[string]any)["starts_local"] != "Tue 17 Nov, 09:30" {
		t.Fatalf("appointment vars %v", vars["appointment"])
	}
}

func TestFailedSendIsRetried(t *testing.T) {
	s, client, outbox := fixture(t)
	now := time.Date(2026, 11, 16, 9, 30, 0, 0, time.UTC)
	t.Setenv("OUTBOX_FAIL", "sms")
	if _, err := Run(s, client, now); err != ErrSomeFailed {
		t.Fatalf("want ErrSomeFailed, got %v", err)
	}
	t.Setenv("OUTBOX_FAIL", "")
	got, err := Run(s, client, now)
	if err != nil || len(got) != 2 || len(messages(t, outbox)) != 2 {
		t.Fatalf("retry: %v %v", got, err)
	}
}
