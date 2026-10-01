package zenith

import (
	"errors"
	"net/http"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/loginattempt"
	"github.com/fudanda/zenith-admin/backend/ent/session"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/ent/usergroup"
	"github.com/fudanda/zenith-admin/backend/ent/usergroupmember"
	"github.com/fudanda/zenith-admin/backend/ent/usergrouprole"
	"github.com/fudanda/zenith-admin/backend/ent/userrole"
	"github.com/gorilla/mux"
	"golang.org/x/crypto/bcrypt"
)

func (f *Framework) roleMemberPreview(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	if _, err = f.scopedRole(r, fromContext(r.Context()), id); err != nil {
		fail(w, 404, "not_found", "角色不存在")
		return
	}
	ids, err := f.Store.Client.UserRole.Query().Where(userrole.RoleIDEQ(id)).Select(userrole.FieldUserID).Ints(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "成员查询失败")
		return
	}
	f.writeMemberPreview(w, r, f.Store.Client.User.Query().Where(user.IDIn(ids...)))
}
func (f *Framework) groupMemberPreview(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	if _, err = f.scopedGroup(r, fromContext(r.Context()), id); err != nil {
		fail(w, 404, "not_found", "用户组不存在")
		return
	}
	ids, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.GroupIDEQ(id)).Select(usergroupmember.FieldUserID).Ints(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "成员查询失败")
		return
	}
	f.writeMemberPreview(w, r, f.Store.Client.User.Query().Where(user.IDIn(ids...)))
}
func (f *Framework) changeGroupMembers(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	row, err := f.scopedGroup(r, p, id)
	if err != nil {
		fail(w, 404, "not_found", "用户组不存在")
		return
	}
	if row.MemberMode != "static" {
		fail(w, 409, "dynamic_group", "动态组不能手工修改成员")
		return
	}
	var in struct {
		UserIDs []int `json:"userIds"`
	}
	if err = decode(r, &in); err != nil || in.UserIDs == nil || len(in.UserIDs) > 5000 {
		fail(w, 400, "invalid_request", "成员列表无效")
		return
	}
	if err = f.validateGroupUsers(r, p, in.UserIDs); err != nil {
		fail(w, 403, "grant_denied", err.Error())
		return
	}
	roles, err := f.Store.Client.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(id)).Select(usergrouprole.FieldRoleID).Ints(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "授权查询失败")
		return
	}
	if err = f.validateGrantRoles(r.Context(), p, roles); err != nil {
		fail(w, 403, "grant_denied", err.Error())
		return
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if r.Method == http.MethodDelete {
			if _, err := tx.UserGroupMember.Delete().Where(usergroupmember.GroupIDEQ(id), usergroupmember.UserIDIn(in.UserIDs...)).Exec(r.Context()); err != nil {
				return err
			}
		} else {
			for _, uid := range in.UserIDs {
				exists, err := tx.UserGroupMember.Query().Where(usergroupmember.GroupIDEQ(id), usergroupmember.UserIDEQ(uid)).Exist(r.Context())
				if err != nil {
					return err
				}
				if !exists {
					if err = tx.UserGroupMember.Create().SetGroupID(id).SetUserID(uid).Exec(r.Context()); err != nil {
						return err
					}
				}
			}
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetResource("user_groups").SetResourceID(id).SetOperation("change_members").Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "成员保存失败")
		return
	}
	respond(w, 200, nil)
}
func (f *Framework) deleteGroupsBatch(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []int `json:"ids"`
	}
	if err := decode(r, &in); err != nil || !validBatchUserIDs(in.IDs) {
		fail(w, 400, "invalid_request", "用户组列表无效")
		return
	}
	p := fromContext(r.Context())
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		count, err := tx.UserGroup.Delete().Where(usergroup.IDIn(in.IDs...)).Exec(r.Context())
		if err != nil {
			return err
		}
		if count != len(in.IDs) {
			return errors.New("部分用户组不存在")
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetResource("user_groups").SetOperation("delete_batch").Exec(r.Context())
	})
	if err != nil {
		fail(w, 409, "delete_failed", "部分用户组不存在或删除失败")
		return
	}
	respond(w, 200, nil)
}
func (f *Framework) resetUsersPasswordBatch(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs      []int  `json:"ids"`
		Password string `json:"password"`
	}
	if err := decode(r, &in); err != nil || !validBatchUserIDs(in.IDs) || len(in.Password) < 6 || len(in.Password) > 72 {
		fail(w, 400, "invalid_request", "账号或密码无效")
		return
	}
	if err := f.validatePassword(r.Context(), in.Password); err != nil {
		fail(w, 400, "invalid_password", err.Error())
		return
	}
	p := fromContext(r.Context())
	for _, id := range in.IDs {
		if _, err := f.visibleUser(r.Context(), p, id); err != nil {
			fail(w, 404, "not_found", "账号不在可管理范围")
			return
		}
		protected, err := f.protectedBatchUser(r, id)
		if err != nil {
			fail(w, 503, "database_unavailable", "授权查询失败")
			return
		}
		if protected && !p.SuperAdmin {
			fail(w, 403, "protected_user", "不能重置系统超级管理员密码")
			return
		}
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		fail(w, 500, "password_error", "密码处理失败")
		return
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if _, err := tx.User.Update().Where(user.IDIn(in.IDs...)).SetPasswordHash(string(hash)).SetPasswordUpdatedAt(time.Now()).Save(r.Context()); err != nil {
			return err
		}
		if _, err := tx.Session.Update().Where(session.UserIDIn(in.IDs...), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(r.Context()); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("reset_password_batch").SetResource("users").Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "密码重置失败")
		return
	}
	respond(w, 200, nil)
}
func (f *Framework) unlockUser(w http.ResponseWriter, r *http.Request) {
	account, id, ok := f.userGrantTarget(w, r)
	if !ok {
		return
	}
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if _, err := tx.LoginAttempt.Delete().Where(loginattempt.UsernameHashEQ(usernameHash(account.Username))).Exec(r.Context()); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(fromContext(r.Context()).User.ID).SetRequestID(requestID(r)).SetOperation("unlock").SetResource("users").SetResourceID(id).Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "清除登录防护失败")
		return
	}
	respond(w, 200, nil)
}
