package zenith

import (
	"errors"
	"net/http"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/session"
	"github.com/fudanda/zenith-admin/backend/ent/user"
)

var errBatchUserMissing = errors.New("部分账号不存在或不在当前可操作范围")
var errBatchUserProtected = errors.New("不能批量删除或停用当前账号、系统超级管理员")

func validBatchUserIDs(ids []int) bool {
	if len(ids) == 0 || len(ids) > 200 {
		return false
	}
	seen := make(map[int]bool, len(ids))
	for _, id := range ids {
		if id < 1 || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}

func (f *Framework) protectedBatchUser(r *http.Request, id int) (bool, error) {
	ids, err := f.effectiveRoleIDs(r.Context(), id)
	if err != nil {
		return false, err
	}
	for _, roleID := range ids {
		row, err := f.Store.Client.Role.Get(r.Context(), roleID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return false, err
		}
		if row.Code == "super_admin" {
			return true, nil
		}
	}
	return false, nil
}

func (f *Framework) batchUsers(w http.ResponseWriter, r *http.Request, ids []int, status *string) {
	if !validBatchUserIDs(ids) {
		fail(w, 400, "invalid_request", "请选择 1 至 200 个不同账号")
		return
	}
	if status != nil && *status != "enabled" && *status != "disabled" {
		fail(w, 400, "invalid_status", "状态无效")
		return
	}
	p := fromContext(r.Context())
	scope, err := f.userDataPredicate(r.Context(), p)
	if err != nil {
		fail(w, 503, "database_unavailable", "数据权限查询失败")
		return
	}
	predicates := []predicate.User{user.IDIn(ids...), userScope(p)}
	if scope != nil {
		predicates = append(predicates, scope)
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		rows, err := tx.User.Query().Where(predicates...).All(r.Context())
		if err != nil {
			return err
		}
		if len(rows) != len(ids) {
			return errBatchUserMissing
		}
		for _, row := range rows {
			if row.ID == p.User.ID && (status == nil || *status == "disabled") {
				return errBatchUserProtected
			}
			if status == nil || *status == "disabled" {
				protected, err := f.protectedBatchUser(r, row.ID)
				if err != nil {
					return err
				}
				if protected {
					return errBatchUserProtected
				}
			}
		}
		operation := "delete_batch"
		if status == nil {
			count, err := tx.User.Delete().Where(predicates...).Exec(r.Context())
			if err != nil {
				return err
			}
			if count != len(ids) {
				return errBatchUserMissing
			}
		} else {
			operation = "status_batch"
			count, err := tx.User.Update().Where(predicates...).SetStatus(*status).Save(r.Context())
			if err != nil {
				return err
			}
			if count != len(ids) {
				return errBatchUserMissing
			}
			if *status == "disabled" {
				if _, err := tx.Session.Update().Where(session.UserIDIn(ids...), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(r.Context()); err != nil {
					return err
				}
			}
		}
		if err := f.syncDynamicGroupsInTx(r.Context(), tx, p); err != nil {
			return err
		}
		audit := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation(operation).SetResource("users")

		return audit.Exec(r.Context())
	})
	if errors.Is(err, errBatchUserMissing) {
		fail(w, 404, "not_found", err.Error())
		return
	}
	if errors.Is(err, errBatchUserProtected) {
		fail(w, 409, "protected_user", err.Error())
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "批量操作失败")
		return
	}
	respond(w, 200, nil)
}

func (f *Framework) deleteUsersBatch(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []int `json:"ids"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, 400, "invalid_request", "账号 ID 列表无效")
		return
	}
	f.batchUsers(w, r, in.IDs, nil)
}

func (f *Framework) updateUsersStatusBatch(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs    []int  `json:"ids"`
		Status string `json:"status"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, 400, "invalid_request", "状态批量请求无效")
		return
	}
	f.batchUsers(w, r, in.IDs, &in.Status)
}
