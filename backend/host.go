package arcbase

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/fudanda/arcbase/backend/internal/contracts"
	"github.com/fudanda/arcbase/backend/internal/kernel"
	"github.com/fudanda/arcbase/backend/internal/modules/authorization"
	"github.com/fudanda/arcbase/backend/internal/modules/integrations"
	"github.com/fudanda/arcbase/backend/internal/modules/organization/positions"
	"github.com/fudanda/arcbase/backend/internal/security"
	httptransport "github.com/fudanda/arcbase/backend/internal/transport/http"
)

// Extension declarations permit host menus and deep links only for mounted modules.
// The host owns its business contracts, migrations and transaction boundaries.
type ExtensionPage struct{ ID, Path, Permission string }
type ExtensionResource struct{ Name, Permission string }
type ExtensionDefinition struct {
	Pages       []ExtensionPage
	Permissions []string
	Resources   []ExtensionResource
}
type DescribedModule interface {
	Module
	Extension() ExtensionDefinition
}
type ServiceModule interface {
	Module
	BindServices(HostServices) error
}

type Actor struct {
	UserID     int
	Username   string
	SuperAdmin bool
	APIKeyID   int
	RequestID  string
}

func CurrentActor(ctx context.Context) (Actor, bool) {
	p := security.FromContext(ctx)
	if p == nil || p.User == nil {
		return Actor{}, false
	}
	return Actor{p.User.ID, p.User.Username, p.SuperAdmin, p.APIKeyID, kernel.TraceID(ctx)}, true
}

var ErrUnauthenticated = kernel.ErrUnauthenticated
var ErrForbidden = errors.New("permission denied")

type HostServices struct {
	Positions PositionService
	Authorize func(context.Context, string) error
	Data      HostData
}

func (f *Framework) HostServices() HostServices {
	return HostServices{Positions: PositionService{f}, Authorize: f.authorizeHost, Data: f.Store.HostData()}
}
func (f *Framework) authorizeHost(ctx context.Context, permission string) error {
	p := security.FromContext(ctx)
	if p == nil {
		return ErrUnauthenticated
	}
	allowed, err := f.services.authorization.Permitted(ctx, p, permission)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrForbidden
	}
	return nil
}

// Positions reuses the real domain service, authorization, data scope and audit transaction.
// It never exposes authentication secrets or internal infrastructure to a host page.
type PositionFilter = positions.Filter
type PositionInput = positions.Input
type Position = contracts.Position
type PositionPage = positions.Page
type PositionService struct{ framework *Framework }

func (s PositionService) List(ctx context.Context, filter PositionFilter, page, size int) (PositionPage, error) {
	if err := s.framework.authorizeHost(ctx, "system:position:list"); err != nil {
		return PositionPage{}, err
	}
	if page < 1 || page > 1000000 || size < 1 || size > 200 {
		return PositionPage{}, &positions.InputError{Code: "invalid_request", Message: "分页参数无效"}
	}
	return s.framework.services.positions.List(ctx, security.FromContext(ctx), filter, page, size)
}
func (s PositionService) Create(ctx context.Context, input PositionInput) (Position, error) {
	if err := s.framework.authorizeHost(ctx, "system:position:create"); err != nil {
		return Position{}, err
	}
	actor, _ := CurrentActor(ctx)
	return s.framework.services.positions.Create(ctx, security.Actor{UserID: actor.UserID, RequestID: actor.RequestID}, input)
}

var Respond = httptransport.Respond
var Fail = httptransport.Fail
var DecodeJSON = httptransport.Decode

var moduleName = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

func describeExtensions(modules []Module) (map[string]ExtensionDefinition, error) {
	result := map[string]ExtensionDefinition{}
	for _, module := range modules {
		described, ok := module.(DescribedModule)
		if !ok {
			continue
		}
		if !moduleName.MatchString(module.Name()) {
			return nil, fmt.Errorf("invalid extension name %q", module.Name())
		}
		definition := described.Extension()
		ids := map[string]bool{}
		paths := map[string]bool{}
		allowed := map[string]bool{}
		for _, permission := range definition.Permissions {
			if !strings.HasPrefix(permission, "host:"+module.Name()+":") || !regexp.MustCompile(`^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*:[a-z][a-z0-9:-]*$`).MatchString(permission) || allowed[permission] {
				return nil, fmt.Errorf("invalid extension permission %q", permission)
			}
			allowed[permission] = true
		}
		for _, page := range definition.Pages {
			if !moduleName.MatchString(page.ID) || ids[page.ID] || paths[page.Path] || !regexp.MustCompile(`^/extensions/`+module.Name()+`/[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*$`).MatchString(page.Path) || page.Permission == "" {
				return nil, fmt.Errorf("invalid extension page %q", page.Path)
			}
			if !allowed[page.Permission] {
				known := false
				for _, menu := range kernel.FoundationMenus {
					if menu.Permission == page.Permission {
						known = true
						break
					}
				}
				if !known {
					return nil, fmt.Errorf("undeclared page permission %q", page.Permission)
				}
			}
			ids[page.ID], paths[page.Path] = true, true
		}
		resourceNames := map[string]bool{}
		for _, resource := range definition.Resources {
			prefix := "host_" + strings.ReplaceAll(module.Name(), "-", "_") + "_"
			if !strings.HasPrefix(resource.Name, prefix) || !regexp.MustCompile(`^[a-z][a-z0-9_]{0,99}$`).MatchString(resource.Name) || !allowed[resource.Permission] || resourceNames[resource.Name] {
				return nil, fmt.Errorf("invalid extension resource %q", resource.Name)
			}
			resourceNames[resource.Name] = true
		}
		result[module.Name()] = definition
	}
	return result, nil
}
func (f *Framework) configureExtensions(definitions map[string]ExtensionDefinition) {
	permissions := map[string]bool{}
	pages := map[string]authorization.ExtensionPage{}
	names := []string{}
	for name := range definitions {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		definition := definitions[name]
		for _, resource := range definition.Resources {
			f.services.integrations.ResourcePermissions[resource.Name] = resource.Permission
		}
		info := integrations.ModuleInfo{ID: name, Pages: []integrations.PageInfo{}}
		for _, permission := range definition.Permissions {
			permissions[permission] = true
		}
		for _, page := range definition.Pages {
			info.Pages = append(info.Pages, integrations.PageInfo{ID: page.ID, Path: page.Path, Permission: page.Permission})
			pages[page.Path] = authorization.ExtensionPage{Permission: page.Permission, Component: "host:" + name + ":" + page.ID}
		}
		f.services.integrations.Modules = append(f.services.integrations.Modules, info)
	}
	f.services.authorization.ExtensionPermissions = permissions
	f.services.authorization.ExtensionPages = pages
}
