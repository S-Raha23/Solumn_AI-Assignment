// Package schedule answers questions about the appointment book.
package schedule

import (
	"time"

	"lindenfield.example/clinicops/internal/store"
)

// StartsLocal formats an appointment start in the clinic's time zone, the way
// patients see it in letters and messages: "Tue 17 Nov, 09:30".
func StartsLocal(a store.Appointment, c store.Clinic) string {
	return a.StartsAt.In(c.Location()).Format("Mon 2 Jan, 15:04")
}

// Day returns the booked and attended appointments that start on a calendar
// day in the clinic's time zone, in start order. clinicianID may be empty.
func Day(s *store.Store, clinicID, clinicianID string, day time.Time) []store.Appointment {
	clinic := s.Clinics[clinicID]
	loc := clinic.Location()
	y, m, d := day.Date()
	from := time.Date(y, m, d, 0, 0, 0, 0, loc)
	to := from.AddDate(0, 0, 1)
	var out []store.Appointment
	for _, a := range s.Appointments {
		if a.ClinicID != clinicID || (clinicianID != "" && a.ClinicianID != clinicianID) {
			continue
		}
		if a.Status != "booked" && a.Status != "attended" {
			continue
		}
		if !a.StartsAt.Before(from) && a.StartsAt.Before(to) {
			out = append(out, a)
		}
	}
	return out
}

// Between returns booked appointments with from < start <= to, in start order.
func Between(s *store.Store, from, to time.Time) []store.Appointment {
	var out []store.Appointment
	for _, a := range s.Appointments {
		if a.Status == "booked" && a.StartsAt.After(from) && !a.StartsAt.After(to) {
			out = append(out, a)
		}
	}
	return out
}

// Overlaps reports appointments for the same clinician that overlap in time.
func Overlaps(s *store.Store) [][2]store.Appointment {
	var out [][2]store.Appointment
	booked := Between(s, time.Time{}, time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC))
	for i := range booked {
		end := booked[i].StartsAt.Add(time.Duration(booked[i].Minutes) * time.Minute)
		for j := i + 1; j < len(booked) && booked[j].StartsAt.Before(end); j++ {
			if booked[j].ClinicianID == booked[i].ClinicianID {
				out = append(out, [2]store.Appointment{booked[i], booked[j]})
			}
		}
	}
	return out
}
