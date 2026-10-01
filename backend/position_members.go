package zenith

import (
	"net/http"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/position"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/ent/userposition"
	"github.com/gorilla/mux"
)

func (f *Framework) memberView(r *http.Request, account *ent.User, joinedAt time.Time) map[string]any {
	var departmentName *string
	if account.DepartmentID != nil {
		if department, err := f.Store.Client.Department.Get(r.Context(), *account.DepartmentID); err == nil {
			departmentName = &department.Name
		}
	}
	return map[string]any{"id": account.ID, "username": account.Username, "nickname": account.Nickname,
		"email": account.Email, "avatar": account.Avatar, "departmentName": departmentName, "joinedAt": joinedAt.Format(time.RFC3339Nano)}
}

func (f *Framework) positionMembers(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	if _, err = f.scopedPosition(r.Context(), p, id); ent.IsNotFound(err) {
		fail(w, 404, "not_found", "岗位不存在")
		return
	} else if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	links, err := f.Store.Client.UserPosition.Query().Where(userposition.PositionIDEQ(id)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	result := make([]map[string]any, 0, len(links))
	for _, link := range links {
		account, err := f.visibleUser(r.Context(), p, link.UserID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}

		result = append(result, f.memberView(r, account, link.CreatedAt))
	}
	respond(w, 200, result)
}

func (f *Framework) positionMemberPreview(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	if _, err = f.scopedPosition(r.Context(), p, id); ent.IsNotFound(err) {
		fail(w, 404, "not_found", "岗位不存在")
		return
	} else if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	page, err := positiveInt(r.URL.Query().Get("page"), 1, 1000000)
	if err != nil {
		fail(w, 400, "invalid_page", err.Error())
		return
	}
	size, err := positiveInt(r.URL.Query().Get("pageSize"), 10, 200)
	if err != nil {
		fail(w, 400, "invalid_page_size", err.Error())
		return
	}
	keyword := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("keyword")))
	links, err := f.Store.Client.UserPosition.Query().Where(userposition.PositionIDEQ(id)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	filtered := make([]map[string]any, 0, len(links))
	for _, link := range links {
		account, err := f.visibleUser(r.Context(), p, link.UserID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		if keyword != "" && !strings.Contains(strings.ToLower(account.Username+" "+account.Nickname), keyword) {
			continue
		}
		filtered = append(filtered, f.memberView(r, account, link.CreatedAt))
	}
	start := (page - 1) * size
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + size
	if end > len(filtered) {
		end = len(filtered)
	}
	respond(w, 200, map[string]any{"list": filtered[start:end], "total": len(filtered), "page": page, "pageSize": size})
}

func (f *Framework) setPositionMembers(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	var input struct {
		UserIDs []int `json:"userIds"`
	}
	if err := decode(r, &input); err != nil || input.UserIDs == nil || len(input.UserIDs) > 5000 {
		fail(w, 400, "invalid_request", "成员列表无效")
		return
	}
	p := fromContext(r.Context())
	seen := map[int]bool{}
	dataScope, err := f.userDataPredicate(r.Context(), p)
	if err != nil {
		fail(w, 503, "database_unavailable", "数据权限查询失败")
		return
	}
	for _, userID := range input.UserIDs {
		if userID < 1 || seen[userID] {
			fail(w, 400, "invalid_request", "成员 ID 无效或重复")
			return
		}
		seen[userID] = true
		if _, err := f.visibleUser(r.Context(), p, userID); err != nil {
			fail(w, 400, "invalid_user", "用户不在可管理范围")
			return
		}
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if _, err := tx.Position.Query().Where(position.IDEQ(id), positionScope(p)).Only(r.Context()); err != nil {
			return err
		}
		for _, userID := range input.UserIDs {
			_, err := tx.User.Get(r.Context(), userID)
			if err != nil {
				return err
			}

		}
		// Replacing visible members must preserve assignments outside the
		// operator's data scope, which the original selector cannot display.
		visible := tx.User.Query().Where(userScope(p))
		if dataScope != nil {
			visible = visible.Where(dataScope)
		}
		visibleIDs, err := visible.IDs(r.Context())
		if err != nil {
			return err
		}
		if _, err := tx.UserPosition.Delete().Where(userposition.PositionIDEQ(id), userposition.UserIDIn(visibleIDs...)).Exec(r.Context()); err != nil {
			return err
		}
		for _, userID := range input.UserIDs {
			if err := tx.UserPosition.Create().SetPositionID(id).SetUserID(userID).Exec(r.Context()); err != nil {
				return err
			}
		}
		if err := f.syncDynamicGroupsInTx(r.Context(), tx, p); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("set_members").SetResource("positions").SetResourceID(id)

		return log.Exec(r.Context())
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "岗位或用户不存在")
		return
	}
	if err != nil {
		fail(w, 400, "invalid_members", err.Error())
		return
	}
	respond(w, 200, nil)
}

func (f *Framework) allUsers(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	query := f.Store.Client.User.Query().Where(user.StatusEQ("enabled"))

	dataScope, err := f.userDataPredicate(r.Context(), p)
	if err != nil {
		fail(w, 503, "database_unavailable", "数据权限查询失败")
		return
	}
	if dataScope != nil {
		query = query.Where(dataScope)
	}
	rows, err := query.Order(ent.Asc(user.FieldNickname)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	result := make([]map[string]any, 0, len(rows))
	for _, account := range rows {
		view, err := f.userView(r, account)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		result = append(result, view)
	}
	respond(w, 200, result)
}
