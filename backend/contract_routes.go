package zenith

import "context"

// foundationModule is the explicit bridge for domains not yet extracted.
// Migrated modules register their own generated operations independently.
type foundationModule struct{ framework *Framework }

func (foundationModule) Name() string           { return "foundation-core" }
func (foundationModule) Dependencies() []string { return nil }
func (m foundationModule) Initialize(_ context.Context, r *Registrar) error {
	return m.framework.registerCore(r)
}
func (foundationModule) Shutdown(context.Context) error { return nil }
