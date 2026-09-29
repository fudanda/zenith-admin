package zenith

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/menu"
	"github.com/fudanda/zenith-admin/backend/ent/rolemenu"
	"github.com/fudanda/zenith-admin/backend/ent/usermenu"
	"github.com/gorilla/mux"
)

var errInvalidMenu = errors.New("菜单数据无效")
var errMenuReferenced = errors.New("菜单仍被角色或用户引用")

type menuInput struct {
	ParentID   int     `json:"parentId"`
	Title      string  `json:"title"`
	Name       *string `json:"name"`
	Path       *string `json:"path"`
	Component  *string `json:"component"`
	Icon       *string `json:"icon"`
	Type       string  `json:"type"`
	Permission *string `json:"permission"`
	Query      *string `json:"query"`
	IsExternal bool    `json:"isExternal"`
	Embed      bool    `json:"embed"`
	KeepAlive  bool    `json:"keepAlive"`
	Sort       int     `json:"sort"`
	Status     string  `json:"status"`
	Visible    bool    `json:"visible"`
}

func menuInputFrom(row *ent.Menu) menuInput {
	return menuInput{ParentID: row.ParentID, Title: row.Title, Name: row.Name, Path: row.Path,
		Component: row.Component, Icon: row.Icon, Type: row.Type, Permission: row.Permission,
		Query: row.Query, IsExternal: row.IsExternal, Embed: row.Embed, KeepAlive: row.KeepAlive,
		Sort: row.Sort, Status: row.Status, Visible: row.Visible}
}

func decodeMenuPatch(r *http.Request) (map[string]json.RawMessage, error) {
	var patch map[string]json.RawMessage
	if err := decode(r, &patch); err != nil {
		return nil, err
	}
	if len(patch) == 0 {
		return nil, fmt.Errorf("%w: 内容不能为空", errInvalidMenu)
	}
	allowed := map[string]bool{"parentId": true, "title": true, "name": true, "path": true,
		"component": true, "icon": true, "type": true, "permission": true, "query": true,
		"isExternal": true, "embed": true, "keepAlive": true, "sort": true, "status": true, "visible": true}
	for key := range patch {
		if !allowed[key] {
			return nil, fmt.Errorf("%w: 未知字段 %s", errInvalidMenu, key)
		}
	}
	return patch, nil
}

func mergeMenuInput(initial menuInput, patch map[string]json.RawMessage) (menuInput, error) {
	encoded, err := json.Marshal(patch)
	if err != nil {
		return initial, err
	}
	if err := json.Unmarshal(encoded, &initial); err != nil {
		return initial, fmt.Errorf("%w: %v", errInvalidMenu, err)
	}
	return initial, nil
}

func validateMenu(in menuInput) error {
	if in.ParentID < 0 || utf8.RuneCountInString(strings.TrimSpace(in.Title)) == 0 || utf8.RuneCountInString(in.Title) > 64 {
		return fmt.Errorf("%w: 标题或父级无效", errInvalidMenu)
	}
	if in.Type != "directory" && in.Type != "menu" && in.Type != "button" {
		return fmt.Errorf("%w: 类型无效", errInvalidMenu)
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return fmt.Errorf("%w: 状态无效", errInvalidMenu)
	}
	for _, field := range []struct {
		value *string
		max   int
	}{{in.Name, 64}, {in.Path, 256}, {in.Component, 256}, {in.Icon, 64}, {in.Permission, 128}, {in.Query, 512}} {
		if field.value != nil && utf8.RuneCountInString(*field.value) > field.max {
			return fmt.Errorf("%w: 字段过长", errInvalidMenu)
		}
	}
	if in.Permission != nil && *in.Permission != "" {
		known := false
		for _, item := range foundationMenus {
			if item.Permission == *in.Permission {
				known = true
				break
			}
		}
		if !known {
			return fmt.Errorf("%w: 权限码未在首版操作清单中", errInvalidMenu)
		}
	}
	if in.Type == "button" && (in.Permission == nil || *in.Permission == "") {
		return fmt.Errorf("%w: 按钮需要权限码", errInvalidMenu)
	}
	if in.Type == "menu" && in.Path != nil && *in.Path != "" {
		registered := false
		for _, item := range foundationMenus {
			if item.Type == "menu" && item.Path == *in.Path {
				registered = true
				break
			}
		}
		if !registered {
			return fmt.Errorf("%w: 页面尚未进入首版构建", errInvalidMenu)
		}
	}
	return nil
}

func menuView(row *ent.Menu) map[string]any {
	view := map[string]any{"id": row.ID, "parentId": row.ParentID, "title": row.Title, "type": row.Type, "sort": row.Sort,
		"status": row.Status, "visible": row.Visible, "featureKey": row.FeatureKey, "query": row.Query,
		"isExternal": row.IsExternal, "embed": row.Embed, "keepAlive": row.KeepAlive,
		"createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}
	for _, field := range []struct {
		key   string
		value *string
	}{{"name", row.Name}, {"path", row.Path},
		{"permission", row.Permission}, {"component", row.Component}, {"icon", row.Icon}} {
		if field.value != nil {
			view[field.key] = *field.value
		}
	}
	return view
}

func menuTree(rows []*ent.Menu) []any {
	byID := make(map[int]map[string]any, len(rows))
	for _, row := range rows {
		byID[row.ID] = menuView(row)
	}
	roots := make([]any, 0)
	for _, row := range rows {
		node := byID[row.ID]
		if parent := byID[row.ParentID]; parent != nil {
			children, _ := parent["children"].([]any)
			parent["children"] = append(children, node)
		} else {
			roots = append(roots, node)
		}
	}
	return roots
}

func (f *Framework) listMenus(w http.ResponseWriter, r *http.Request) {
	rows, err := f.Store.Client.Menu.Query().Order(ent.Asc(menu.FieldSort), ent.Asc(menu.FieldID)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if strings.HasSuffix(r.URL.Path, "/flat") {
		list := make([]any, 0, len(rows))
		for _, row := range rows {
			list = append(list, menuView(row))
		}
		respond(w, 200, list)
		return
	}
	respond(w, 200, menuTree(rows))
}

func (f *Framework) userMenus(w http.ResponseWriter, r *http.Request) {
	rows, err := f.accessibleMenus(r.Context(), fromContext(r.Context()))
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	visible := make([]*ent.Menu, 0, len(rows))
	for _, row := range rows {
		if row.Type != "button" && row.Visible {
			visible = append(visible, row)
		}
	}
	respond(w, 200, menuTree(visible))
}

func (f *Framework) getMenu(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	row, err := f.Store.Client.Menu.Get(r.Context(), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "菜单不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, menuView(row))
}

func validateMenuParent(ctx context.Context, tx *ent.Tx, id, parentID int) error {
	seen := map[int]bool{id: true}
	for parentID != 0 {
		if seen[parentID] {
			return fmt.Errorf("%w: 不能移动到自身或后代", errInvalidMenu)
		}
		seen[parentID] = true
		parent, err := tx.Menu.Get(ctx, parentID)
		if ent.IsNotFound(err) {
			return fmt.Errorf("%w: 父菜单不存在", errInvalidMenu)
		}
		if err != nil {
			return err
		}
		if parent.Type == "button" {
			return fmt.Errorf("%w: 按钮不能作为父级", errInvalidMenu)
		}
		parentID = parent.ParentID
	}
	return nil
}

func applyMenuCreate(create *ent.MenuCreate, in menuInput) *ent.MenuCreate {
	create.SetParentID(in.ParentID).SetTitle(strings.TrimSpace(in.Title)).SetType(in.Type).SetSort(in.Sort).
		SetStatus(in.Status).SetVisible(in.Visible).SetIsExternal(in.IsExternal).SetEmbed(in.Embed).SetKeepAlive(in.KeepAlive)
	create.SetNillableName(in.Name).SetNillablePath(in.Path).SetNillableComponent(in.Component).
		SetNillableIcon(in.Icon).SetNillablePermission(in.Permission).SetNillableQuery(in.Query)
	return create
}

func applyMenuUpdate(update *ent.MenuUpdateOne, in menuInput) *ent.MenuUpdateOne {
	update.SetParentID(in.ParentID).SetTitle(strings.TrimSpace(in.Title)).SetType(in.Type).SetSort(in.Sort).
		SetStatus(in.Status).SetVisible(in.Visible).SetIsExternal(in.IsExternal).SetEmbed(in.Embed).SetKeepAlive(in.KeepAlive)
	if in.Name == nil {
		update.ClearName()
	} else {
		update.SetName(*in.Name)
	}
	if in.Path == nil {
		update.ClearPath()
	} else {
		update.SetPath(*in.Path)
	}
	if in.Component == nil {
		update.ClearComponent()
	} else {
		update.SetComponent(*in.Component)
	}
	if in.Icon == nil {
		update.ClearIcon()
	} else {
		update.SetIcon(*in.Icon)
	}
	if in.Permission == nil {
		update.ClearPermission()
	} else {
		update.SetPermission(*in.Permission)
	}
	if in.Query == nil {
		update.ClearQuery()
	} else {
		update.SetQuery(*in.Query)
	}
	return update
}

func auditMenu(ctx context.Context, tx *ent.Tx, actorID int, trace, action string, id int) error {
	return tx.AuditLog.Create().SetActorID(actorID).SetRequestID(trace).SetOperation(action).
		SetResource("menus").SetResourceID(id).Exec(ctx)
}

func (f *Framework) saveMenu(w http.ResponseWriter, r *http.Request) {
	id := 0
	if r.Method == http.MethodPut {
		var err error
		id, err = intParam(mux.Vars(r)["id"])
		if err != nil {
			fail(w, 400, "invalid_id", err.Error())
			return
		}
	}
	patch, err := decodeMenuPatch(r)
	if err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	p := fromContext(r.Context())
	var saved *ent.Menu
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		in := menuInput{Type: "menu", Status: "enabled", Visible: true}
		if id != 0 {
			current, err := tx.Menu.Get(r.Context(), id)
			if err != nil {
				return err
			}
			in = menuInputFrom(current)
		}
		in, err = mergeMenuInput(in, patch)
		if err != nil {
			return err
		}
		if err := validateMenu(in); err != nil {
			return err
		}
		if err := validateMenuParent(r.Context(), tx, id, in.ParentID); err != nil {
			return err
		}
		if id != 0 && in.Type == "button" {
			hasChildren, err := tx.Menu.Query().Where(menu.ParentIDEQ(id)).Exist(r.Context())
			if err != nil {
				return err
			}
			if hasChildren {
				return fmt.Errorf("%w: 有子菜单的节点不能改为按钮", errInvalidMenu)
			}
		}
		if id == 0 {
			saved, err = applyMenuCreate(tx.Menu.Create(), in).Save(r.Context())
		} else {
			saved, err = applyMenuUpdate(tx.Menu.UpdateOneID(id), in).Save(r.Context())
		}
		if err != nil {
			return err
		}
		action := "update"
		if id == 0 {
			action = "create"
		}
		return auditMenu(r.Context(), tx, p.User.ID, requestID(r), action, saved.ID)
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "菜单不存在")
		return
	}
	if errors.Is(err, errInvalidMenu) {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	if err != nil {
		fail(w, 409, "menu_conflict", "菜单保存失败，请检查名称是否重复")
		return
	}
	status := 200
	if id == 0 {
		status = 201
	}
	respond(w, status, menuView(saved))
}

func (f *Framework) deleteMenu(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		rows, err := tx.Menu.Query().All(r.Context())
		if err != nil {
			return err
		}
		children := map[int][]int{}
		found := false
		for _, row := range rows {
			children[row.ParentID] = append(children[row.ParentID], row.ID)
			if row.ID == id {
				found = true
			}
		}
		if !found {
			return &ent.NotFoundError{}
		}
		ids := []int{id}
		seen := map[int]bool{id: true}
		for i := 0; i < len(ids); i++ {
			for _, child := range children[ids[i]] {
				if !seen[child] {
					ids = append(ids, child)
					seen[child] = true
				}
			}
		}
		if assigned, err := tx.UserMenu.Query().Where(usermenu.MenuIDIn(ids...)).Exist(r.Context()); err != nil {
			return err
		} else if assigned {
			return errMenuReferenced
		}
		links, err := tx.RoleMenu.Query().Where(rolemenu.MenuIDIn(ids...)).All(r.Context())
		if err != nil {
			return err
		}
		for _, link := range links {
			role, err := tx.Role.Get(r.Context(), link.RoleID)
			if err != nil {
				return err
			}
			if role.Code != "super_admin" {
				return errMenuReferenced
			}
		}
		for i := len(ids) - 1; i >= 0; i-- {
			if err := tx.Menu.DeleteOneID(ids[i]).Exec(r.Context()); err != nil {
				return err
			}
		}
		return auditMenu(r.Context(), tx, p.User.ID, requestID(r), "delete", id)
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "菜单不存在")
		return
	}
	if errors.Is(err, errMenuReferenced) {
		fail(w, 409, "menu_referenced", err.Error())
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "删除失败")
		return
	}
	respond(w, 200, nil)
}
