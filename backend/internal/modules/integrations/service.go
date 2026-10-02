package integrations

import (
	"context"
	"sort"
	"strconv"
	"sync"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/fudanda/zenith-admin/backend/internal/contracts"
	"github.com/fudanda/zenith-admin/backend/internal/data"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
)

type Reader func(context.Context, kernel.Input) (kernel.Outcome, error)
type Tool struct {
	Name, Description, Permission string
	Read                          Reader
}
type Dependencies struct {
	Permitted       func(context.Context, *kernel.Principal, string) (bool, error)
	Authenticate    func(context.Context, string) (*kernel.Principal, error)
	AuthenticateKey func(context.Context, string) (*kernel.Principal, error)
	Tools           []Tool
}
type Service struct {
	Modules             []ModuleInfo
	ResourcePermissions map[string]string
	store               *data.Store
	deps                Dependencies
	stop                chan struct{}
	once                sync.Once
}

type PageInfo struct {
	ID         string `json:"id"`
	Path       string `json:"path"`
	Permission string `json:"permission"`
}
type ModuleInfo struct {
	ID    string     `json:"id"`
	Pages []PageInfo `json:"pages"`
}

func (s *Service) ModuleCatalog() []ModuleInfo { return s.Modules }

func NewService(store *data.Store, deps Dependencies) *Service {
	return &Service{store: store, deps: deps, stop: make(chan struct{}), Modules: []ModuleInfo{}, ResourcePermissions: map[string]string{}}
}
func (s *Service) Close()                   { s.once.Do(func() { close(s.stop) }) }
func (s *Service) Stopped() <-chan struct{} { return s.stop }
func (s *Service) Authenticate(ctx context.Context, token string, key bool) (*kernel.Principal, error) {
	if key {
		return s.deps.AuthenticateKey(ctx, token)
	}
	return s.deps.Authenticate(ctx, token)
}
func (s *Service) Tools(ctx context.Context, p *kernel.Principal) ([]Tool, error) {
	values := []Tool{}
	for _, tool := range s.deps.Tools {
		ok, err := s.deps.Permitted(ctx, p, tool.Permission)
		if err != nil {
			return nil, err
		}
		if ok {
			values = append(values, tool)
		}
	}
	return values, nil
}
func (s *Service) Read(ctx context.Context, tool Tool, page, pageSize int, keyword string) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	if p == nil {
		return kernel.Outcome{}, kernel.ErrUnauthenticated
	}
	ok, err := s.deps.Permitted(ctx, p, tool.Permission)
	if err != nil {
		return kernel.Outcome{}, err
	}
	if !ok {
		return kernel.Outcome{}, kernel.Fail(403, "forbidden", "没有工具权限")
	}
	if page < 1 || pageSize < 1 || pageSize > 100 || len([]rune(keyword)) > 100 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_query", "分页或关键字无效")
	}
	return tool.Read(ctx, kernel.Input{Filter: kernel.Values{"page": {strconv.Itoa(page)}, "pageSize": {strconv.Itoa(pageSize)}, "keyword": {keyword}}, TraceID: kernel.TraceID(ctx)})
}

// Durable audit IDs are cursors. Events contain resource names only, never
// entity identifiers, field values, actors or counts. Reads still apply scope.
func (s *Service) Changes(ctx context.Context, p *kernel.Principal, cursor int) (int, []string, error) {
	latest, err := s.store.Client.AuditLog.Query().Order(ent.Desc(auditlog.FieldID)).First(ctx)
	if ent.IsNotFound(err) {
		return 0, []string{}, nil
	}
	if err != nil {
		return 0, nil, err
	}
	if cursor < 0 || cursor > latest.ID {
		return latest.ID, []string{"*"}, nil
	}
	rows, err := s.store.Client.AuditLog.Query().Where(auditlog.IDGT(cursor)).Order(ent.Asc(auditlog.FieldID)).Limit(101).All(ctx)
	if err != nil {
		return cursor, nil, err
	}
	if len(rows) > 100 {
		return latest.ID, []string{"*"}, nil
	}
	permissions := map[string]string{"positions": "system:position:list", "departments": "system:department:list", "users": "system:user:list", "roles": "system:role:list", "user_groups": "system:user-groups:list", "menus": "system:menu:list", "dicts": "system:dict:list", "dict_items": "system:dict:list", "files": "system:file:list", "settings": "system:settings:list", "sessions": "system:session:list"}
	for resource, permission := range s.ResourcePermissions {
		permissions[resource] = permission
	}
	set := map[string]bool{}
	for _, row := range rows {
		cursor = row.ID
		// Permission and policy changes can affect the receiver even when they
		// cannot read the changed admin domain. Send a generic requery only.
		_, setting := contracts.Settings[row.Resource]
		if row.Resource == "users" || row.Resource == "roles" || row.Resource == "user_groups" || setting {
			set["*"] = true
			continue
		}
		permission := permissions[row.Resource]
		if row.ActorID == p.User.ID && p.APIKeyID == 0 {
			if permission != "" {
				set[row.Resource] = true
			}
			continue
		}
		if permission == "" {
			continue
		}
		allowed, err := s.deps.Permitted(ctx, p, permission)
		if err != nil {
			return cursor, nil, err
		}
		if allowed {
			set[row.Resource] = true
		}
	}
	values := []string{}
	for value := range set {
		values = append(values, value)
	}
	sort.Strings(values)
	return cursor, values, nil
}
func (s *Service) AuditMCP(ctx context.Context, method string) error {
	p := kernel.FromContext(ctx)
	record := s.store.Client.AuditLog.Create().SetActorID(p.User.ID).SetOperation("mcp_read").SetResource("mcp").SetDescription(method).SetRequestID(kernel.TraceID(ctx))
	if p.APIKeyID != 0 {
		record.SetAPIKeyID(p.APIKeyID)
	}
	return record.Exec(ctx)
}
