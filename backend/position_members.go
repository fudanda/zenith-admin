package zenith

import (
	"net/http"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/user"
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
