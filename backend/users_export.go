package zenith

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/loginlog"
	"github.com/fudanda/zenith-admin/backend/ent/position"
)

func (f *Framework) exportUsersCSV(w http.ResponseWriter, r *http.Request) {
	query, err := f.filteredUsers(r, fromContext(r.Context()), r.URL.Query())
	if errors.Is(err, errUserFilter) {
		fail(w, 400, "invalid_filter", err.Error())
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "数据权限查询失败")
		return
	}
	streamCSV(w, "users.csv", []string{"ID", "用户名", "昵称", "部门", "状态", "邮箱", "手机号", "角色", "岗位", "最后登录时间", "创建时间", "更新时间"}, func(offset int) ([][]string, error) {
		accounts, err := query.Clone().Offset(offset).Limit(200).All(r.Context())
		if err != nil {
			return nil, err
		}
		result := make([][]string, 0, len(accounts))
		for _, account := range accounts {
			view, err := f.userView(r, account)
			if err != nil {
				return nil, err
			}
			departmentName := ""
			if name, ok := view["departmentName"].(*string); ok && name != nil {
				departmentName = *name
			}
			roleNames := make([]string, 0)
			for _, item := range view["roles"].([]any) {
				roleNames = append(roleNames, item.(map[string]any)["name"].(string))
			}
			positionNames := make([]string, 0)
			ids := view["positionIds"].([]int)
			if len(ids) > 0 {
				rows, err := f.Store.Client.Position.Query().Where(position.IDIn(ids...)).All(r.Context())
				if err != nil {
					return nil, err
				}
				for _, row := range rows {
					positionNames = append(positionNames, row.Name)
				}
			}
			lastLogin := ""
			log, err := f.Store.Client.LoginLog.Query().Where(loginlog.UserIDEQ(account.ID), loginlog.SuccessEQ(true)).Order(ent.Desc(loginlog.FieldCreatedAt)).First(r.Context())
			if err == nil {
				lastLogin = log.CreatedAt.Format(time.RFC3339)
			} else if !ent.IsNotFound(err) {
				return nil, err
			}
			email, phone := "", ""
			if account.Email != nil && *account.Email != "" {
				email = "***"
			}
			if account.Phone != nil && *account.Phone != "" {
				phone = "***"
			}
			result = append(result, []string{strconv.Itoa(account.ID), account.Username, account.Nickname, departmentName, account.Status, email, phone, strings.Join(roleNames, ", "), strings.Join(positionNames, ", "), lastLogin, account.CreatedAt.Format(time.RFC3339), account.UpdatedAt.Format(time.RFC3339)})
		}
		return result, nil
	})
}
