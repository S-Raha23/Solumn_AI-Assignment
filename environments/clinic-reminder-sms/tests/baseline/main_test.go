package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setup(t *testing.T) string {
	t.Helper()
	abs, _ := filepath.Abs("../../data")
	t.Setenv("CLINIC_DATA", abs)
	outbox := t.TempDir()
	t.Setenv("OUTBOX_ROOT", outbox)
	return outbox
}

func TestAgendaUsesClinicTime(t *testing.T) {
	setup(t)
	var out, errOut bytes.Buffer
	if code := run([]string{"agenda", "--clinic", "bristol", "--date", "2026-11-17", "--clinician", "cl-ruiz"}, &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 4 || !strings.HasPrefix(lines[1], "09:30  30m  Eleanor Pike (pt-1001)  follow-up") {
		t.Fatalf("unexpected agenda:\n%s", out.String())
	}
}

func TestSyncEHRSendsDay(t *testing.T) {
	outbox := setup(t)
	var out, errOut bytes.Buffer
	if code := run([]string{"sync-ehr", "--clinic", "cork", "--date", "2026-11-17"}, &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	raw, err := os.ReadFile(filepath.Join(outbox, "ehr", "00001.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Body struct {
			Entries []ehrEntry `json:"entries"`
		} `json:"body"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil || len(doc.Body.Entries) != 3 {
		t.Fatalf("bad ehr batch: %v %s", err, raw)
	}
	if doc.Body.Entries[0].Patient.ID != "pt-1003" {
		t.Fatalf("first entry is %s", doc.Body.Entries[0].Patient.ID)
	}
}

func TestUsage(t *testing.T) {
	setup(t)
	var out, errOut bytes.Buffer
	if code := run([]string{"bogus"}, &out, &errOut); code != 64 {
		t.Fatalf("exit %d", code)
	}
}
