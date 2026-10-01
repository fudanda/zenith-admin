//go:build integration

package zenith

import (
	"os"
	"testing"
)

// Reuse behavioral checks with each real database selected by the CI matrix.
func TestDatabaseExtensions(t *testing.T) {
	dsn := os.Getenv("ZENITH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ZENITH_TEST_DATABASE_URL required")
	}
	for name, verify := range map[string]func(*testing.T, *extensionFixture){"APIKey": testAPIKeyLifecycle, "MCP": testReadOnlyMCP, "SSE": testSubscription} {
		t.Run(name, func(t *testing.T) { verify(t, extensionFixtureDSN(t, isolatedTestDSN(t, dsn))) })
	}
}
