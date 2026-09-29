package zenith

import (
	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/menu"
	"github.com/gorilla/mux"
	"net/http"
)

func menuView(row *ent.Menu) map[string]any {
	view := map[string]any{"id": row.ID, "parentId": row.ParentID, "title": row.Title, "type": row.Type, "sort": row.Sort,
		"status": row.Status, "visible": row.Visible, "featureKey": row.FeatureKey, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}
	if row.Name != nil {
		view["name"] = *row.Name
	}
	if row.Path != nil {
		view["path"] = *row.Path
	}
	if row.Permission != nil {
		view["permission"] = *row.Permission
	}
	if row.Component != nil {
		view["component"] = *row.Component
	}
	if row.Icon != nil {
		view["icon"] = *row.Icon
	}
	return view
}

func (f *Framework) listMenus(w http.ResponseWriter, r *http.Request) {
	rows, err := f.Store.Client.Menu.Query().Order(ent.Asc(menu.FieldSort), ent.Asc(menu.FieldID)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, menuView(row))
	}
	respond(w, 200, list)
}

func (f *Framework) userMenus(w http.ResponseWriter, r *http.Request) {
	rows, err := f.accessibleMenus(r.Context(), fromContext(r.Context()))
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		if row.Type != "button" && row.Visible {
			list = append(list, menuView(row))
		}
	}
	respond(w, 200, list)
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
