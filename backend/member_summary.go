package zenith

import (
	"context"
	"net/http"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/gorilla/mux"
)

// The same data predicate governs counts, previews and paginated selectors.
func (f *Framework) visibleMemberQuery(ctx context.Context, p *principal, query *ent.UserQuery) (*ent.UserQuery, error) {
	dataScope, err := f.userDataPredicate(ctx, p)
	if err != nil {
		return nil, err
	}
	if dataScope != nil {
		query = query.Where(dataScope)
	}
	return query, nil
}

func (f *Framework) memberSummary(ctx context.Context, p *principal, query *ent.UserQuery) (int, []map[string]any, error) {
	query, err := f.visibleMemberQuery(ctx, p, query)
	if err != nil {
		return 0, nil, err
	}
	count, err := query.Clone().Count(ctx)
	if err != nil {
		return 0, nil, err
	}
	rows, err := query.Order(ent.Asc(user.FieldID)).Limit(5).All(ctx)
	if err != nil {
		return 0, nil, err
	}
	preview := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		preview = append(preview, map[string]any{"id": row.ID, "nickname": row.Nickname, "avatar": row.Avatar})
	}
	return count, preview, nil
}

func (f *Framework) departmentMemberPreview(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	if _, err = f.Store.Client.Department.Get(r.Context(), id); ent.IsNotFound(err) {
		fail(w, 404, "not_found", "部门不存在")
		return
	} else if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	query := f.Store.Client.User.Query().Where(user.DepartmentIDEQ(id))
	f.writeMemberPreview(w, r, query)
}

func (f *Framework) writeMemberPreview(w http.ResponseWriter, r *http.Request, query *ent.UserQuery) {
	page, err := positiveInt(r.URL.Query().Get("page"), 1, 1000000)
	if err != nil {
		fail(w, 400, "invalid_query", err.Error())
		return
	}
	size, err := positiveInt(r.URL.Query().Get("pageSize"), 10, 200)
	if err != nil {
		fail(w, 400, "invalid_query", err.Error())
		return
	}
	query, err = f.visibleMemberQuery(r.Context(), fromContext(r.Context()), query)
	if err != nil {
		fail(w, 503, "database_unavailable", "数据权限查询失败")
		return
	}
	if keyword := strings.TrimSpace(r.URL.Query().Get("keyword")); keyword != "" {
		query = query.Where(user.Or(user.UsernameContainsFold(keyword), user.NicknameContainsFold(keyword)))
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Order(ent.Asc(user.FieldID)).Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, map[string]any{"id": row.ID, "username": row.Username, "nickname": row.Nickname, "avatar": row.Avatar})
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}
