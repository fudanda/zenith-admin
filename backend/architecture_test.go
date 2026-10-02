package arcbase

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Domain services, HTTP adapters and infrastructure have separate ownership.
// Generated Ent/contracts and released SQL retain their original locations.
func TestBackendPackageBoundaries(t *testing.T) {
	const module = "github.com/fudanda/arcbase/backend"
	err := filepath.WalkDir("internal", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		rel := filepath.ToSlash(path)
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		service := strings.HasPrefix(rel, "internal/modules/") && !strings.HasSuffix(rel, "/handler.go") && !strings.HasSuffix(rel, "/module.go")
		for _, spec := range file.Imports {
			importPath, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				return err
			}
			forbidden := importPath == module
			if service {
				forbidden = forbidden || importPath == "net/http" || importPath == "net/url" || strings.HasPrefix(importPath, "gofr.dev/") || strings.HasPrefix(importPath, module+"/internal/transport/") || importPath == module+"/internal/app"
			}
			if strings.HasPrefix(rel, "internal/data/") {
				forbidden = forbidden || strings.HasPrefix(importPath, module+"/internal/modules/") || importPath == "net/http" || strings.HasPrefix(importPath, module+"/internal/app") || strings.HasPrefix(importPath, module+"/internal/transport/")
			}
			if strings.HasPrefix(rel, "internal/transport/") {
				forbidden = forbidden || strings.HasPrefix(importPath, module+"/ent") || importPath == module+"/internal/data" || strings.HasPrefix(importPath, module+"/internal/modules/")
			}
			if strings.HasPrefix(rel, "internal/app/") {
				forbidden = forbidden || strings.HasPrefix(importPath, module+"/ent") || importPath == module+"/internal/data" || strings.HasPrefix(importPath, module+"/internal/modules/")
			}
			if strings.HasPrefix(rel, "internal/kernel/") {
				forbidden = forbidden || importPath == "net/http" || importPath == module+"/internal/data" || strings.HasPrefix(importPath, module+"/internal/modules/") || strings.HasPrefix(importPath, module+"/internal/transport/") || strings.HasPrefix(importPath, "gofr.dev/")
			}
			if strings.HasSuffix(rel, "/handler.go") {
				forbidden = forbidden || strings.HasPrefix(importPath, module+"/ent") || importPath == module+"/internal/data" || importPath == "database/sql"
			}
			if forbidden {
				t.Errorf("%s imports forbidden layer %s", rel, importPath)
			}
		}
		if strings.HasSuffix(rel, "/handler.go") {
			ast.Inspect(file, func(node ast.Node) bool {
				if selector, ok := node.(*ast.SelectorExpr); ok && (selector.Sel.Name == "WithTx" || selector.Sel.Name == "Client" || selector.Sel.Name == "DB") {
					t.Errorf("%s accesses persistence in HTTP handler", rel)
				}
				return true
			})
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestNoFoundationBridgeAndDomainMethodsInRoot(t *testing.T) {
	for _, module := range builtinDeclarations() {
		if module.Name() == "foundation-core" {
			t.Fatal("transitional foundation module returned")
		}
	}
	for _, name := range []string{"contract_routes.go", "routes.go", "users.go", "departments.go", "roles.go", "menus.go", "files.go", "auth.go"} {
		if _, err := fs.Stat(os.DirFS("."), name); err == nil {
			t.Errorf("domain implementation returned to root: %s", name)
		}
	}
}
