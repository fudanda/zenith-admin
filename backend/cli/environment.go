package cli

import (
	"os"
	"strings"
)

// Environment prefers an explicitly configured ArcBase value, including an
// empty value. The legacy prefix remains readable during an existing upgrade.
func Environment(name string) string {
	if value, ok := os.LookupEnv(name); ok {
		return value
	}
	if strings.HasPrefix(name, "ARCBASE_") {
		return os.Getenv("ZENITH_" + strings.TrimPrefix(name, "ARCBASE_"))
	}
	return os.Getenv(name)
}
