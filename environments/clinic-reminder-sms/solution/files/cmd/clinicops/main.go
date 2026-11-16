// Command clinicops runs the clinic group's scheduled jobs.
//
//	clinicops agenda   --clinic ID --date YYYY-MM-DD [--clinician ID]
//	clinicops sync-ehr --clinic ID --date YYYY-MM-DD
//	clinicops overlaps
//	clinicops remind   [--now RFC3339]
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	_ "time/tzdata"

	"lindenfield.example/clinicops/internal/notify"
	"lindenfield.example/clinicops/internal/reminders"
	"lindenfield.example/clinicops/internal/render"
	"lindenfield.example/clinicops/internal/schedule"
	"lindenfield.example/clinicops/internal/store"
)

const agendaLine = "{{starts}}  {{minutes}}m  {{patient.first_name}} {{patient.last_name}} ({{patient.id}})  {{appointment.kind}}  [{{clinician.display_name}}]"

var errUsage = errors.New("usage")

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "usage: clinicops agenda|sync-ehr|overlaps|remind [flags]")
		return 64
	}
	s, err := store.Load(store.Dir())
	if err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}
	switch args[0] {
	case "agenda":
		err = agenda(s, args[1:], stdout)
	case "sync-ehr":
		err = syncEHR(s, args[1:], stdout, notify.NewClient())
	case "remind":
		err = remind(s, args[1:], stdout, notify.NewClient())
		if errors.Is(err, reminders.ErrSomeFailed) {
			fmt.Fprintln(stderr, "error:", err)
			return 3
		}
	case "overlaps":
		for _, pair := range schedule.Overlaps(s) {
			fmt.Fprintf(stdout, "%s overlaps %s (%s)\n", pair[0].ID, pair[1].ID, pair[0].ClinicianID)
		}
	default:
		err = errUsage
	}
	if errors.Is(err, errUsage) {
		fmt.Fprintln(stderr, "usage: clinicops agenda|sync-ehr|overlaps|remind [flags]")
		return 64
	}
	if err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}
	return 0
}

func dayFlags(name string, args []string) (clinic, clinician string, day time.Time, err error) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&clinic, "clinic", "", "clinic id")
	fs.StringVar(&clinician, "clinician", "", "clinician id")
	date := fs.String("date", "", "YYYY-MM-DD")
	if err = fs.Parse(args); err != nil || clinic == "" {
		return "", "", time.Time{}, errUsage
	}
	day, err = time.Parse("2006-01-02", *date)
	if err != nil {
		return "", "", time.Time{}, errUsage
	}
	return clinic, clinician, day, nil
}

// agenda prints a clinician's day sheet.
func agenda(s *store.Store, args []string, out io.Writer) error {
	clinicID, clinicianID, day, err := dayFlags("agenda", args)
	if err != nil {
		return err
	}
	clinic, ok := s.Clinics[clinicID]
	if !ok {
		return fmt.Errorf("unknown clinic %s", clinicID)
	}
	fmt.Fprintf(out, "%s, %s\n", clinic.Name, day.Format("Monday 2 January 2006"))
	for _, a := range schedule.Day(s, clinicID, clinicianID, day) {
		line, err := render.Render(agendaLine, map[string]any{
			"starts":      a.StartsAt.In(clinic.Location()).Format("15:04"),
			"minutes":     fmt.Sprint(a.Minutes),
			"appointment": a,
			"patient":     s.Patients[a.PatientID],
			"clinician":   s.Clinicians[a.ClinicianID],
		})
		if err != nil {
			return err
		}
		fmt.Fprintln(out, line)
	}
	return nil
}

type ehrEntry struct {
	Appointment store.Appointment `json:"appointment"`
	Patient     store.Patient     `json:"patient"`
	Clinician   store.Clinician   `json:"clinician"`
}

// syncEHR pushes a clinic's day to the clinical records system, which keeps
// the full appointment and patient record alongside its own notes.
func syncEHR(s *store.Store, args []string, out io.Writer, client *notify.Client) error {
	clinicID, _, day, err := dayFlags("sync-ehr", args)
	if err != nil {
		return err
	}
	if _, ok := s.Clinics[clinicID]; !ok {
		return fmt.Errorf("unknown clinic %s", clinicID)
	}
	batch := struct {
		Clinic  string     `json:"clinic"`
		Date    string     `json:"date"`
		Entries []ehrEntry `json:"entries"`
	}{Clinic: clinicID, Date: day.Format("2006-01-02")}
	for _, a := range schedule.Day(s, clinicID, "", day) {
		batch.Entries = append(batch.Entries, ehrEntry{a, s.Patients[a.PatientID], s.Clinicians[a.ClinicianID]})
	}
	if err := client.Send("ehr", batch); err != nil {
		return err
	}
	fmt.Fprintf(out, "synced %d appointment(s) for %s %s\n", len(batch.Entries), clinicID, batch.Date)
	return nil
}

// remind sends the day-before SMS reminders that are due.
func remind(s *store.Store, args []string, out io.Writer, client *notify.Client) error {
	fs := flag.NewFlagSet("remind", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	nowFlag := fs.String("now", "", "RFC3339 clock")
	if err := fs.Parse(args); err != nil {
		return errUsage
	}
	now := time.Now()
	if *nowFlag != "" {
		parsed, err := time.Parse(time.RFC3339, *nowFlag)
		if err != nil {
			return errUsage
		}
		now = parsed
	}
	client.Now = func() time.Time { return now }
	ids, err := reminders.Run(s, client, now)
	for _, id := range ids {
		fmt.Fprintf(out, "reminded %s\n", id)
	}
	fmt.Fprintf(out, "sent %d\n", len(ids))
	return err
}
