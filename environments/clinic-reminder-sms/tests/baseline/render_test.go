package render

import (
	"errors"
	"testing"
)

func TestRenderNestedAndStructs(t *testing.T) {
	type person struct {
		First string `json:"first_name"`
	}
	got, err := Render("Hi {{ p.first_name }}, {{n}} at {{place.name}}", map[string]any{
		"p": person{First: "Ana"}, "n": 3, "place": map[string]string{"name": "Bristol"},
	})
	if err != nil || got != "Hi Ana, 3 at Bristol" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestRenderMissing(t *testing.T) {
	_, err := Render("{{a.b}}", map[string]any{"a": map[string]any{}})
	var missing MissingError
	if !errors.As(err, &missing) || missing.Path != "a.b" {
		t.Fatalf("want MissingError for a.b, got %v", err)
	}
}
