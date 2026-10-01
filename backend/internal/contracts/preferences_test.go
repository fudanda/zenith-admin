package contracts

import "testing"

func TestPreferenceValidation(t *testing.T) {
	for _, input := range []map[string]any{{}, {"colorMode": "dark", "tablePageSize": float64(20)}, {"homePath": "/system/positions", "themeColor": "#123abc"}} {
		if err := ValidatePreferences(input); err != nil {
			t.Fatalf("valid override rejected: %v", err)
		}
	}
	for _, input := range []map[string]any{{"colorMode": "invalid"}, {"tablePageSize": float64(3)}, {"sidebarWidth": float64(1)}, {"colorMode": nil}, {"unknown": true}, {"showQuickChat": true}, {"homePath": "//evil.test"}, {"themeColor": "bad"}} {
		if err := ValidatePreferences(input); err == nil {
			t.Fatalf("invalid override accepted: %v", input)
		}
	}
}
