package cli

import (
	"os"
	"testing"
)

func TestEnvironmentUpgrade(t *testing.T) {
	const name = "ARCBASE_DATABASE_URL"
	before, existed := os.LookupEnv(name)
	os.Unsetenv(name)
	t.Cleanup(func() {
		if existed {
			os.Setenv(name, before)
		} else {
			os.Unsetenv(name)
		}
	})
	t.Setenv("ZENITH_DATABASE_URL", "sqlite:./existing.db")
	if Environment(name) != "sqlite:./existing.db" {
		t.Fatal("legacy deployment lost")
	}
	t.Setenv(name, "sqlite:./new.db")
	if Environment(name) != "sqlite:./new.db" {
		t.Fatal("new setting must win")
	}
	t.Setenv(name, "")
	if Environment(name) != "" {
		t.Fatal("explicit empty setting must win")
	}
}
