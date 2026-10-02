package usergroups

import (
	"context"
	"net/http"

	httptransport "github.com/fudanda/arcbase/backend/internal/transport/http"
)

type Module struct{ handler *Handler }

func NewModule(handler *Handler) *Module       { return &Module{handler} }
func (*Module) Name() string                   { return "usergroups" }
func (*Module) Dependencies() []string         { return nil }
func (*Module) Shutdown(context.Context) error { return nil }
func (m *Module) Initialize(_ context.Context, reg *httptransport.Registrar) error {
	for _, op := range []struct {
		id      string
		handler http.HandlerFunc
	}{
		{"userGroupsRulePreview", m.handler.PreviewGroupRule},
		{"userGroupsRemoveBatch", m.handler.DeleteGroupsBatch},
		{"userGroupsAll", m.handler.AllGroups},
		{"userGroupsList", m.handler.ListGroups},
		{"userGroupsCreate", m.handler.SaveGroup},
		{"userGroupsMemberPreview", m.handler.GroupMemberPreview},
		{"userGroupsMembers", m.handler.GroupMembers},
		{"userGroupsSetMembers", m.handler.SetGroupMembers},
		{"userGroupsAddMembers", m.handler.ChangeGroupMembers},
		{"userGroupsRemoveMembers", m.handler.ChangeGroupMembers},
		{"userGroupsRoles", m.handler.GroupRoles},
		{"userGroupsSetRoles", m.handler.SetGroupRoles},
		{"userGroupsSync", m.handler.SyncGroup},
		{"userGroupsDetail", m.handler.GetGroup},
		{"userGroupsUpdate", m.handler.SaveGroup},
		{"userGroupsRemove", m.handler.DeleteGroup},
	} {
		if err := reg.RegisterContract(op.id, op.handler); err != nil {
			return err
		}
	}
	return nil
}
