package zenith

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/session"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/gorilla/mux"
)

func browserName(agent string) string {
	for _, name := range []string{"Edg/", "Firefox/", "Chrome/", "Safari/"} {
		if strings.Contains(agent, name) {
			return strings.TrimSuffix(name, "/")
		}
	}
	return ""
}
func osName(agent string) string {
	for _, name := range []string{"Android", "iPhone", "iPad", "Windows", "Mac OS", "Linux"} {
		if strings.Contains(agent, name) {
			return name
		}
	}
	return ""
}

func sessionView(row *ent.Session, p *principal) map[string]any {
	return map[string]any{"tokenId": strconv.Itoa(row.ID), "client": row.Client, "ip": row.IP, "location": nil, "browser": row.Browser, "os": row.Os, "loginAt": row.CreatedAt, "lastActiveAt": row.LastActiveAt, "isCurrent": p != nil && p.Session != nil && row.ID == p.Session.ID}
}
func (f *Framework) onlineSessions(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
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
	users, err := f.visibleMemberQuery(r.Context(), p, f.Store.Client.User.Query().Where(user.StatusEQ("enabled")))
	if err != nil {
		fail(w, 503, "database_unavailable", "数据权限查询失败")
		return
	}
	accounts, err := users.All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "账号查询失败")
		return
	}
	byID := map[int]*ent.User{}
	ids := make([]int, 0, len(accounts))
	for _, account := range accounts {
		byID[account.ID] = account
		ids = append(ids, account.ID)
	}
	query := f.Store.Client.Session.Query().Where(session.UserIDIn(ids...), session.RevokedAtIsNil(), session.ExpiresAtGT(time.Now()))
	if client := r.URL.Query().Get("client"); client != "" {
		if client != "web" && client != "desktop" && client != "mobile" {
			fail(w, 400, "invalid_query", "终端类型无效")
			return
		}
		query = query.Where(session.ClientEQ(client))
	}
	keyword := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("keyword")))
	rows, err := query.Order(ent.Desc(session.FieldLastActiveAt)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "会话查询失败")
		return
	}
	list := make([]map[string]any, 0)
	for _, row := range rows {
		account := byID[row.UserID]
		if keyword != "" && !strings.Contains(strings.ToLower(account.Username+account.Nickname+row.IP), keyword) {
			continue
		}
		item := sessionView(row, p)
		item["userId"] = account.ID
		item["username"] = account.Username
		item["nickname"] = account.Nickname
		list = append(list, item)
	}
	total := len(list)
	start := (page - 1) * size
	if start > total {
		start = total
	}
	end := start + size
	if end > total {
		end = total
	}
	respond(w, 200, map[string]any{"list": list[start:end], "total": total, "page": page, "pageSize": size})
}
func (f *Framework) forceLogout(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	vars := mux.Vars(r)
	uid, err := intParam(vars["id"])
	sid := 0
	if vars["tokenId"] != "" {
		sid, err = intParam(vars["tokenId"])
		if err == nil {
			row, e := f.Store.Client.Session.Get(r.Context(), sid)
			if e != nil {
				fail(w, 404, "not_found", "会话不存在")
				return
			}
			uid = row.UserID
		}
	}
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	if _, err = f.visibleUser(r.Context(), p, uid); err != nil {
		fail(w, 404, "not_found", "账号不在可管理范围")
		return
	}
	protected, err := f.protectedBatchUser(r, uid)
	if err != nil {
		fail(w, 503, "database_unavailable", "授权查询失败")
		return
	}
	if protected && !p.SuperAdmin {
		fail(w, 403, "protected_user", "不能强制下线系统超级管理员")
		return
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		q := tx.Session.Update().Where(session.UserIDEQ(uid), session.RevokedAtIsNil())
		if sid != 0 {
			q = q.Where(session.IDEQ(sid))
		}
		if _, err := q.SetRevokedAt(time.Now()).Save(r.Context()); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("force_logout").SetResource("users").SetResourceID(uid).Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "强制下线失败")
		return
	}
	respond(w, 200, nil)
}
