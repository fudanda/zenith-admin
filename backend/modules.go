package arcbase

import (
	"github.com/fudanda/arcbase/backend/internal/kernel"
	audit "github.com/fudanda/arcbase/backend/internal/modules/audit"
	authorization "github.com/fudanda/arcbase/backend/internal/modules/authorization"
	configuration "github.com/fudanda/arcbase/backend/internal/modules/configuration"
	files "github.com/fudanda/arcbase/backend/internal/modules/files"
	identity "github.com/fudanda/arcbase/backend/internal/modules/identity"
	integrations "github.com/fudanda/arcbase/backend/internal/modules/integrations"
	organization "github.com/fudanda/arcbase/backend/internal/modules/organization"
	positions "github.com/fudanda/arcbase/backend/internal/modules/organization/positions"
	relations "github.com/fudanda/arcbase/backend/internal/modules/relations"
	system "github.com/fudanda/arcbase/backend/internal/modules/system"
	transfers "github.com/fudanda/arcbase/backend/internal/modules/transfers"
	usergroups "github.com/fudanda/arcbase/backend/internal/modules/usergroups"
)

func builtinDeclarations() []Module {
	return []Module{
		audit.NewModule(nil),
		authorization.NewModule(nil),
		configuration.NewModule(nil),
		files.NewModule(nil),
		identity.NewModule(nil),
		integrations.NewModule(nil),
		organization.NewModule(nil),
		relations.NewModule(nil),
		system.NewModule(nil),
		transfers.NewModule(nil),
		usergroups.NewModule(nil),
		positions.NewModule(nil),
	}
}
func builtinModules(s *services) []Module {
	return []Module{
		audit.NewModule(audit.NewHandler(s.audit)),
		authorization.NewModule(authorization.NewHandler(s.authorization)),
		configuration.NewModule(configuration.NewHandler(s.configuration)),
		files.NewModule(files.NewHandler(s.files)),
		identity.NewModule(identity.NewHandler(s.identity)),
		integrations.NewModule(integrations.NewHandler(s.integrations)),
		organization.NewModule(organization.NewHandler(s.organization)),
		relations.NewModule(relations.NewHandler(s.relations)),
		system.NewModule(system.NewHandler(s.system)),
		transfers.NewModule(transfers.NewHandler(s.transfers)),
		usergroups.NewModule(usergroups.NewHandler(s.usergroups)),
		positions.NewModule(positions.NewHandler(s.positions, kernel.TraceID)),
	}
}
