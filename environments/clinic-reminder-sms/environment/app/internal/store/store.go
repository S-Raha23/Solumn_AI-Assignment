// Package store loads the clinic group's records from JSON files.
package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

type Contact struct {
	SMS   bool `json:"sms"`
	Email bool `json:"email"`
}

type Referral struct {
	Source string `json:"source"`
	Reason string `json:"reason"`
}

type Patient struct {
	ID              string   `json:"id"`
	FirstName       string   `json:"first_name"`
	LastName        string   `json:"last_name"`
	DateOfBirth     string   `json:"date_of_birth"`
	Phone           string   `json:"phone"`
	Email           string   `json:"email"`
	Contact         Contact  `json:"contact"`
	NHSNumber       string   `json:"nhs_number"`
	ClinicalSummary string   `json:"clinical_summary"`
	Referral        Referral `json:"referral"`
}

type Clinician struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
	Email       string `json:"email"`
}

type Clinic struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Phone       string `json:"phone"`
	Address     string `json:"address"`
	TimeZone    string `json:"time_zone"`
	SMSTemplate string `json:"sms_template"`
}

type Appointment struct {
	ID          string    `json:"id"`
	PatientID   string    `json:"patient_id"`
	ClinicianID string    `json:"clinician_id"`
	ClinicID    string    `json:"clinic_id"`
	Kind        string    `json:"kind"`
	StartsAt    time.Time `json:"starts_at"`
	Minutes     int       `json:"minutes"`
	Status      string    `json:"status"` // booked, cancelled, attended, no_show
}

// Store holds every record, indexed by id.
type Store struct {
	Dir          string
	Patients     map[string]Patient
	Clinicians   map[string]Clinician
	Clinics      map[string]Clinic
	Appointments []Appointment
}

// Dir returns the data directory: $CLINIC_DATA, or ./data.
func Dir() string {
	if dir := os.Getenv("CLINIC_DATA"); dir != "" {
		return dir
	}
	return "data"
}

func readJSON(dir, name string, into any) error {
	raw, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, into); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}

// Load reads all record files from dir and checks references between them.
func Load(dir string) (*Store, error) {
	var patients []Patient
	var clinicians []Clinician
	var clinics []Clinic
	s := &Store{Dir: dir, Patients: map[string]Patient{}, Clinicians: map[string]Clinician{}, Clinics: map[string]Clinic{}}
	for name, into := range map[string]any{
		"patients.json": &patients, "clinicians.json": &clinicians,
		"clinics.json": &clinics, "appointments.json": &s.Appointments,
	} {
		if err := readJSON(dir, name, into); err != nil {
			return nil, err
		}
	}
	for _, p := range patients {
		s.Patients[p.ID] = p
	}
	for _, c := range clinicians {
		s.Clinicians[c.ID] = c
	}
	for _, c := range clinics {
		if _, err := time.LoadLocation(c.TimeZone); err != nil {
			return nil, fmt.Errorf("clinic %s: %w", c.ID, err)
		}
		s.Clinics[c.ID] = c
	}
	for _, a := range s.Appointments {
		if _, ok := s.Patients[a.PatientID]; !ok {
			return nil, fmt.Errorf("appointment %s: unknown patient %s", a.ID, a.PatientID)
		}
		if _, ok := s.Clinicians[a.ClinicianID]; !ok {
			return nil, fmt.Errorf("appointment %s: unknown clinician %s", a.ID, a.ClinicianID)
		}
		if _, ok := s.Clinics[a.ClinicID]; !ok {
			return nil, fmt.Errorf("appointment %s: unknown clinic %s", a.ID, a.ClinicID)
		}
	}
	sort.Slice(s.Appointments, func(i, j int) bool {
		if !s.Appointments[i].StartsAt.Equal(s.Appointments[j].StartsAt) {
			return s.Appointments[i].StartsAt.Before(s.Appointments[j].StartsAt)
		}
		return s.Appointments[i].ID < s.Appointments[j].ID
	})
	return s, nil
}

// Location is the clinic's time zone. Load has already validated it.
func (c Clinic) Location() *time.Location {
	loc, _ := time.LoadLocation(c.TimeZone)
	return loc
}
