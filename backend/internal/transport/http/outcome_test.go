package httptransport

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadInputAllowsJSONHeaderWithoutBody(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		r := httptest.NewRequest(method, "/api/v1/files?purpose=preview", nil)
		r.Header.Set("Content-Type", "application/json")
		input, err := ReadInput(httptest.NewRecorder(), r)
		if err != nil || input.Filter.Get("purpose") != "preview" || len(input.Body) != 0 {
			t.Fatalf("%s header-only request: %+v %v", method, input, err)
		}
	}
	r := httptest.NewRequest(http.MethodPost, "/api/v1/users", strings.NewReader(`{"nickname":"valid"}`))
	r.Header.Set("Content-Type", "application/json")
	input, err := ReadInput(httptest.NewRecorder(), r)
	if err != nil || !strings.Contains(string(input.Body), "valid") {
		t.Fatal("JSON payload lost", err)
	}
}
