package arcbase

import (
	"context"
	"io"
	"strconv"
	"time"

	"github.com/fudanda/arcbase/backend/ent"
	"github.com/fudanda/arcbase/backend/ent/predicate"
	"github.com/fudanda/arcbase/backend/internal/data"
	"github.com/fudanda/arcbase/backend/internal/kernel"
	audit "github.com/fudanda/arcbase/backend/internal/modules/audit"
	authorization "github.com/fudanda/arcbase/backend/internal/modules/authorization"
	bootstrap "github.com/fudanda/arcbase/backend/internal/modules/bootstrap"
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

type services struct {
	authorization *authorization.Service
	bootstrap     *bootstrap.Service
	files         *files.Service
	identity      *identity.Service
	integrations  *integrations.Service
	relations     *relations.Service
	system        *system.Service
	transfers     *transfers.Service
	configuration *configuration.Service
	organization  *organization.Service
	usergroups    *usergroups.Service
	audit         *audit.Service
	positions     *positions.Service
}

func assembleServices(store *Store, provider FileStorage) *services {
	s := &services{}
	var db *data.Store
	if store != nil {
		db = store.Store
	}
	s.transfers = transfers.NewService(db, transfers.Dependencies{
		Permits: func(arg0 context.Context, arg1 kernel.Input, arg2 string) (bool, error) {
			return s.authorization.Permits(arg0, arg1, arg2)
		},
		Export: func(arg0 context.Context, arg1 string, arg2 kernel.Input) (kernel.Outcome, error) {
			return s.export(arg0, arg1, arg2)
		},
		Permissions: func(ctx context.Context, p *kernel.Principal) ([]string, error) {
			return s.authorization.Permissions(ctx, p)
		},
		VisibleUser: func(ctx context.Context, p *kernel.Principal, id int) (*ent.User, error) {
			return s.authorization.VisibleUser(ctx, p, id)
		},
		ValidatePassword: func(ctx context.Context, password string) error { return s.identity.ValidatePassword(ctx, password) },
		ValidateGrantScope: func(ctx context.Context, p *kernel.Principal, scope string, departments []int) error {
			return s.authorization.ValidateGrantScope(ctx, p, scope, departments)
		},
		ValidateUserRelationsContext: func(ctx context.Context, p *kernel.Principal, in kernel.UserInput) error {
			return s.organization.ValidateUserRelationsContext(ctx, p, in)
		},
		SyncDynamicGroupsInTx: func(ctx context.Context, tx *ent.Tx, actor *kernel.Principal) error {
			return s.usergroups.SyncDynamicGroupsInTx(ctx, tx, actor)
		},
		EffectiveRoleIDs: func(ctx context.Context, userID int) ([]int, error) {
			return s.authorization.EffectiveRoleIDs(ctx, userID)
		},
	})
	s.configuration = configuration.NewService(db, configuration.Dependencies{
		Permitted: func(ctx context.Context, p *kernel.Principal, permission string) (bool, error) {
			return s.authorization.Permitted(ctx, p, permission)
		},
	})
	s.organization = organization.NewService(db, organization.Dependencies{
		ScopedPosition: func(arg0 context.Context, arg1 *kernel.Principal, arg2 int) (*ent.Position, error) {
			return s.positions.Scoped(arg0, arg2)
		},
		MemberSummary: func(ctx context.Context, p *kernel.Principal, query *ent.UserQuery) (int, []map[string]any, error) {
			return s.authorization.MemberSummary(ctx, p, query)
		},
		VisibleUser: func(ctx context.Context, p *kernel.Principal, id int) (*ent.User, error) {
			return s.authorization.VisibleUser(ctx, p, id)
		},
		SyncDynamicGroupsInTx: func(ctx context.Context, tx *ent.Tx, actor *kernel.Principal) error {
			return s.usergroups.SyncDynamicGroupsInTx(ctx, tx, actor)
		},
		WriteMemberPreview: func(ctx context.Context, inArgs kernel.Input, query *ent.UserQuery) (kernel.Outcome, error) {
			return s.authorization.WriteMemberPreview(ctx, inArgs, query)
		},
		UserDataPredicate: func(ctx context.Context, p *kernel.Principal) (predicate.User, error) {
			return s.authorization.UserDataPredicate(ctx, p)
		},
		SecurityPolicy: func(ctx context.Context) (kernel.SecurityPolicy, error) { return s.identity.SecurityPolicy(ctx) },
		ValidateGrantRoles: func(ctx context.Context, p *kernel.Principal, ids []int) error {
			return s.authorization.ValidateGrantRoles(ctx, p, ids)
		},
		ValidatePassword: func(ctx context.Context, password string) error { return s.identity.ValidatePassword(ctx, password) },
		EffectiveRoleIDs: func(ctx context.Context, userID int) ([]int, error) {
			return s.authorization.EffectiveRoleIDs(ctx, userID)
		},
		UserGrantTarget: func(arg0 context.Context, arg1 kernel.
			Input) (*ent.User, int, error) {
			return s.authorization.UserGrantTarget(arg0, arg1)
		},
	})
	s.usergroups = usergroups.NewService(db, usergroups.Dependencies{
		VisibleUser: func(ctx context.Context, p *kernel.Principal, id int) (*ent.User, error) {
			return s.authorization.VisibleUser(ctx, p, id)
		},
		ValidateGrantRoles: func(ctx context.Context, p *kernel.Principal, ids []int) error {
			return s.authorization.ValidateGrantRoles(ctx, p, ids)
		},
		WriteMemberPreview: func(ctx context.Context, inArgs kernel.Input, query *ent.UserQuery) (kernel.Outcome, error) {
			return s.authorization.WriteMemberPreview(ctx, inArgs, query)
		},
		MemberSummary: func(ctx context.Context, p *kernel.Principal, query *ent.UserQuery) (int, []map[string]any, error) {
			return s.authorization.MemberSummary(ctx, p, query)
		},
		VisibleMemberQuery: func(ctx context.Context, p *kernel.Principal, query *ent.UserQuery) (*ent.UserQuery, error) {
			return s.authorization.VisibleMemberQuery(ctx, p, query)
		},
		MemberView: func(ctx context.Context, inArgs kernel.Input, account *ent.User, joinedAt time.Time) map[string]any {
			return s.organization.MemberView(ctx, inArgs, account, joinedAt)
		},
	})
	s.audit = audit.NewService(db, audit.Dependencies{
		UserDataPredicate: func(ctx context.Context, p *kernel.Principal) (predicate.User, error) {
			return s.authorization.UserDataPredicate(ctx, p)
		},
	})
	s.authorization = authorization.NewService(db, authorization.Dependencies{
		ScopedUser: func(arg0 context.Context, arg1 kernel.Input, arg2 *kernel.Principal, arg3 int) (*ent.User, error) {
			return s.organization.ScopedUser(arg0, arg1, arg2, arg3)
		},
		ProtectedBatchUser: func(ctx context.Context, inArgs kernel.Input, id int) (bool, error) {
			return s.organization.ProtectedBatchUser(ctx, inArgs, id)
		},
	})
	s.bootstrap = bootstrap.NewService(db, bootstrap.Dependencies{
		ValidatePassword: func(ctx context.Context, password string) error { return s.identity.ValidatePassword(ctx, password) },
	})
	s.files = files.NewService(db, files.Dependencies{
		Permitted: func(arg0 context.Context, arg1 *kernel.Principal, arg2 string) (bool, error) {
			return s.authorization.Permitted(arg0, arg1, arg2)
		},
		LoadFileSettings: func(ctx context.Context) (kernel.FileSettings, *ent.SystemSetting, error) {
			return s.configuration.LoadFileSettings(ctx)
		},
	})
	s.identity = identity.NewService(db, identity.Dependencies{
		EffectiveRoleIDs: func(arg0 context.Context, arg1 int) ([]int, error) {
			return s.authorization.EffectiveRoleIDs(arg0, arg1)
		},
		UserView: func(ctx context.Context, inArgs kernel.Input, account *ent.User) (map[string]any, error) {
			return s.organization.UserView(ctx, inArgs, account)
		},
		LoadSetting: func(ctx context.Context, module string) (map[string]any, *ent.SystemSetting, error) {
			return s.configuration.LoadSetting(ctx, module)
		},
		AccessibleMenus: func(ctx context.Context, p *kernel.Principal) ([]*ent.Menu, error) {
			return s.authorization.AccessibleMenus(ctx, p)
		},
		Permissions: func(ctx context.Context, p *kernel.Principal) ([]string, error) {
			return s.authorization.Permissions(ctx, p)
		},
		PersistFile: func(ctx context.Context, p *kernel.Principal, input io.Reader, rawName, visibility, trace string, maxBytes int64) (map[string]any, error) {
			return s.files.PersistFile(ctx, p, input, rawName, visibility, trace, maxBytes)
		},
		VisibleMemberQuery: func(ctx context.Context, p *kernel.Principal, query *ent.UserQuery) (*ent.UserQuery, error) {
			return s.authorization.VisibleMemberQuery(ctx, p, query)
		},
		VisibleUser: func(ctx context.Context, p *kernel.Principal, id int) (*ent.User, error) {
			return s.authorization.VisibleUser(ctx, p, id)
		},
		ProtectedBatchUser: func(ctx context.Context, inArgs kernel.Input, id int) (bool, error) {
			return s.organization.ProtectedBatchUser(ctx, inArgs, id)
		},
	})
	s.relations = relations.NewService(db, relations.Dependencies{
		Permits: func(ctx context.Context, inArgs kernel.Input, permission string) (bool, error) {
			return s.authorization.Permits(ctx, inArgs, permission)
		},
		VisibleUser: func(ctx context.Context, p *kernel.Principal, id int) (*ent.User, error) {
			return s.authorization.VisibleUser(ctx, p, id)
		},
		FilteredAuditLogs: func(ctx context.Context, p *kernel.Principal, q kernel.Values) (*ent.AuditLogQuery, error) {
			return s.audit.FilteredAuditLogs(ctx, p, q)
		},
	})
	s.system = system.NewService(db, system.Dependencies{})
	s.files.FileStorage = provider
	s.positions = positions.NewService(db, positionAccess{s})
	s.integrations = integrations.NewService(db, integrations.Dependencies{
		Permitted: s.authorization.Permitted, Authenticate: s.identity.Authenticate, AuthenticateKey: s.identity.RevalidateKey,
		Tools: []integrations.Tool{
			{Name: "users_list", Description: "只读账号列表，执行当前账号的数据范围。", Permission: "system:user:list", Read: s.organization.ListUsers},
			{Name: "departments_list", Description: "只读组织部门。", Permission: "system:department:list", Read: s.organization.PagedDepartments},
			{Name: "positions_list", Description: "只读岗位。", Permission: "system:position:list", Read: func(ctx context.Context, in kernel.Input) (kernel.Outcome, error) {
				page, _ := strconv.Atoi(in.Filter.Get("page"))
				size, _ := strconv.Atoi(in.Filter.Get("pageSize"))
				result, err := s.positions.List(ctx, kernel.FromContext(ctx), positions.Filter{Keyword: in.Filter.Get("keyword")}, page, size)
				return kernel.Outcome{Status: 200, Data: result}, err
			}},
			{Name: "files_list", Description: "只读文件元数据，不返回存储凭据或文件字节。", Permission: "system:file:list", Read: s.files.ListFiles},
			{Name: "login_logs_list", Description: "只读授权范围内的登录日志。", Permission: "system:log:login", Read: s.audit.ListLoginLogs},
			{Name: "operation_logs_list", Description: "只读授权范围内的操作审计。", Permission: "system:log:operation", Read: s.audit.ListAuditLogs},
		},
	})
	return s
}
