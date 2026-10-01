package zenith

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/department"
	"github.com/fudanda/zenith-admin/backend/ent/loginattempt"
	"github.com/fudanda/zenith-admin/backend/ent/loginlog"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/session"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/ent/userposition"
	"github.com/fudanda/zenith-admin/backend/ent/userrole"
	"github.com/gorilla/mux"
	"golang.org/x/crypto/bcrypt"
)

var phonePattern = regexp.MustCompile(`^1[3-9][0-9]{9}$`)

func userScope(_ *principal) predicate.User { return user.IDGT(0) }

func (f *Framework) scopedUser(r *http.Request, p *principal, id int) (*ent.User, error) {
	return f.visibleUser(r.Context(), p, id)
}

func (f *Framework) userView(r *http.Request, account *ent.User) (map[string]any, error) {
	var departmentName *string
	if account.DepartmentID != nil {
		dept, err := f.Store.Client.Department.Get(r.Context(), *account.DepartmentID)
		if err == nil {
			departmentName = &dept.Name
		} else if !ent.IsNotFound(err) {
			return nil, err
		}
	}
	ids, err := f.Store.Client.UserRole.Query().Where(userrole.UserIDEQ(account.ID)).Select(userrole.FieldRoleID).Ints(r.Context())
	if err != nil {
		return nil, err
	}
	roles := make([]any, 0, len(ids))
	for _, id := range ids {
		row, err := f.Store.Client.Role.Get(r.Context(), id)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		roles = append(roles, map[string]any{"id": row.ID, "name": row.Name, "code": row.Code, "dataScope": row.DataScope, "status": row.Status, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt})
	}
	links, err := f.Store.Client.UserPosition.Query().Where(userposition.UserIDEQ(account.ID)).All(r.Context())
	if err != nil {
		return nil, err
	}
	positionIDs := make([]int, 0, len(links))
	for _, link := range links {
		positionIDs = append(positionIDs, link.PositionID)
	}
	positions := make([]map[string]any, 0, len(positionIDs))
	for _, id := range positionIDs {
		position, err := f.Store.Client.Position.Get(r.Context(), id)
		if err != nil {
			return nil, err
		}
		positions = append(positions, map[string]any{"id": position.ID, "name": position.Name, "code": position.Code, "sort": position.Sort, "status": position.Status, "createdAt": position.CreatedAt, "updatedAt": position.UpdatedAt})
	}
	online, err := f.Store.Client.Session.Query().Where(session.UserIDEQ(account.ID), session.RevokedAtIsNil(), session.ExpiresAtGT(time.Now())).Order(ent.Desc(session.FieldLastActiveAt)).First(r.Context())
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	var lastActive *time.Time
	if online != nil {
		lastActive = &online.LastActiveAt
	}
	latest, err := f.Store.Client.LoginLog.Query().Where(loginlog.UserIDEQ(account.ID), loginlog.SuccessEQ(true)).Order(ent.Desc(loginlog.FieldCreatedAt)).First(r.Context())
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	var lastLogin *time.Time
	var loginIP *string
	if latest != nil {
		lastLogin = &latest.CreatedAt
		loginIP = &latest.IP
	}
	defense, err := f.Store.Client.LoginAttempt.Query().Where(loginattempt.UsernameHashEQ(usernameHash(account.Username)), loginattempt.LockedUntilGT(time.Now())).First(r.Context())
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	policy, err := f.securityPolicy(r.Context())
	if err != nil {
		return nil, err
	}
	expired := policy.Password.ExpiryEnabled && account.PasswordUpdatedAt.AddDate(0, 0, policy.Password.ExpiryDays).Before(time.Now())
	return map[string]any{"id": account.ID, "username": account.Username, "nickname": account.Nickname, "email": account.Email, "phone": account.Phone, "gender": account.Gender, "birthDate": account.BirthDate,
		"avatar": account.Avatar, "departmentId": account.DepartmentID, "departmentName": departmentName, "positionIds": positionIDs, "positions": positions, "roles": roles, "isOnline": online != nil, "lastActiveAt": lastActive, "lastLoginAt": lastLogin, "lastLoginIp": loginIP, "loginChallengeRequired": defense != nil && defense.Failures > 0,
		"status": account.Status, "requirePasswordChange": expired, "passwordUpdatedAt": account.PasswordUpdatedAt, "createdAt": account.CreatedAt, "updatedAt": account.UpdatedAt}, nil
}

func (f *Framework) listUsers(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	q := r.URL.Query()
	page, err := positiveInt(q.Get("page"), 1, 1000000)
	if err != nil {
		fail(w, 400, "invalid_page", err.Error())
		return
	}
	size, err := positiveInt(q.Get("pageSize"), 10, 200)
	if err != nil {
		fail(w, 400, "invalid_page_size", err.Error())
		return
	}
	query, err := f.filteredUsers(r, p, q)
	if errors.Is(err, errUserFilter) {
		fail(w, 400, "invalid_filter", err.Error())
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "数据权限查询失败")
		return
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, account := range rows {
		view, err := f.userView(r, account)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		list = append(list, view)
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

var errUserFilter = errors.New("账号筛选条件无效")

func (f *Framework) filteredUsers(r *http.Request, p *principal, q url.Values) (*ent.UserQuery, error) {
	query := f.Store.Client.User.Query().Where(userScope(p))
	dataScope, err := f.userDataPredicate(r.Context(), p)
	if err != nil {
		return nil, err
	}
	if dataScope != nil {
		query = query.Where(dataScope)
	}
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(user.Or(user.UsernameContainsFold(keyword), user.NicknameContainsFold(keyword), user.EmailContainsFold(keyword)))
	}
	if phone := strings.TrimSpace(q.Get("phone")); phone != "" {
		query = query.Where(user.PhoneContains(phone))
	}
	if status := q.Get("status"); status != "" {
		if status != "enabled" && status != "disabled" {
			return nil, fmt.Errorf("%w: 状态无效", errUserFilter)
		}
		query = query.Where(user.StatusEQ(status))
	}
	if raw := q.Get("departmentId"); raw != "" {
		id, err := intParam(raw)
		if err != nil {
			return nil, fmt.Errorf("%w: 部门 ID 无效", errUserFilter)
		}
		query = query.Where(user.DepartmentIDEQ(id))
	}
	for _, bound := range []struct {
		key string
		end bool
	}{{"startTime", false}, {"endTime", true}} {
		if raw := q.Get(bound.key); raw != "" {
			value, err := parseFilterDateBound(raw, bound.end)
			if err != nil {
				return nil, fmt.Errorf("%w: %s", errUserFilter, err)
			}
			if bound.end {
				query = query.Where(user.CreatedAtLTE(value))
			} else {
				query = query.Where(user.CreatedAtGTE(value))
			}
		}
	}
	return query.Order(ent.Desc(user.FieldID)), nil
}

func (f *Framework) getUser(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	account, err := f.scopedUser(r, fromContext(r.Context()), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "账号不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	view, err := f.userView(r, account)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, view)
}

type userInput struct {
	Username     string  `json:"username"`
	Nickname     string  `json:"nickname"`
	Password     string  `json:"password"`
	Email        *string `json:"email"`
	Phone        *string `json:"phone"`
	Gender       *string `json:"gender"`
	BirthDate    *string `json:"birthDate"`
	Avatar       *string `json:"avatar"`
	DepartmentID *int    `json:"departmentId"`
	PositionIDs  []int   `json:"positionIds"`
	RoleIDs      []int   `json:"roleIds"`
	Status       string  `json:"status"`
}

func validateUser(in userInput, creating bool) error {
	if len(in.Username) < 2 || len(in.Username) > 32 || strings.ContainsAny(in.Username, " \t\r\n") {
		return errors.New("用户名无效")
	}
	if len([]rune(strings.TrimSpace(in.Nickname))) == 0 || len([]rune(in.Nickname)) > 32 {
		return errors.New("昵称无效")
	}
	if creating && (len(in.Password) < 6 || len(in.Password) > 72) {
		return errors.New("密码至少 6 位且不超过 72 字节")
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("状态无效")
	}
	if in.Email != nil && *in.Email != "" && (!strings.Contains(*in.Email, "@") || len(*in.Email) > 128) {
		return errors.New("邮箱无效")
	}
	if in.Phone != nil && *in.Phone != "" && !phonePattern.MatchString(*in.Phone) {
		return errors.New("手机号无效")
	}
	return nil
}

func (f *Framework) validateUserRelations(r *http.Request, p *principal, in userInput) error {
	return f.validateUserRelationsContext(r.Context(), p, in)
}
func (f *Framework) validateUserRelationsContext(ctx context.Context, p *principal, in userInput) error {
	if in.DepartmentID != nil {
		if _, err := f.Store.Client.Department.Query().Where(department.IDEQ(*in.DepartmentID), departmentScope(p)).Only(ctx); err != nil {
			return errors.New("部门不存在")
		}
	}
	seen := map[int]bool{}
	for _, id := range in.PositionIDs {
		if id < 1 || seen[id] {
			return errors.New("岗位 ID 无效或重复")
		}
		seen[id] = true
		if _, err := f.scopedPosition(ctx, p, id); err != nil {
			return errors.New("岗位不存在")
		}
	}
	if err := f.validateGrantRoles(ctx, p, in.RoleIDs); err != nil {
		return err
	}

	return nil
}

func applyUserCreate(create *ent.UserCreate, in userInput, p *principal, hash []byte) {
	create.SetUsername(in.Username).SetNickname(in.Nickname).SetPasswordHash(string(hash)).SetStatus(in.Status)

	if in.Email != nil {
		create.SetEmail(*in.Email)
	}
	if in.Phone != nil {
		create.SetPhone(*in.Phone)
	}
	if in.Gender != nil {
		create.SetGender(*in.Gender)
	}
	if in.BirthDate != nil {
		create.SetBirthDate(*in.BirthDate)
	}
	if in.Avatar != nil {
		create.SetAvatar(*in.Avatar)
	}
	if in.DepartmentID != nil {
		create.SetDepartmentID(*in.DepartmentID)
	}
}

func applyUserUpdate(update *ent.UserUpdateOne, in userInput) {
	update.SetUsername(in.Username).SetNickname(in.Nickname).SetStatus(in.Status)
	if in.Email == nil {
		update.ClearEmail()
	} else {
		update.SetEmail(*in.Email)
	}
	if in.Phone == nil {
		update.ClearPhone()
	} else {
		update.SetPhone(*in.Phone)
	}
	if in.Gender == nil {
		update.ClearGender()
	} else {
		update.SetGender(*in.Gender)
	}
	if in.BirthDate == nil {
		update.ClearBirthDate()
	} else {
		update.SetBirthDate(*in.BirthDate)
	}
	if in.Avatar == nil {
		update.ClearAvatar()
	} else {
		update.SetAvatar(*in.Avatar)
	}
	if in.DepartmentID == nil {
		update.ClearDepartmentID()
	} else {
		update.SetDepartmentID(*in.DepartmentID)
	}
}

func (f *Framework) saveUser(w http.ResponseWriter, r *http.Request) {
	id := 0
	if r.Method == http.MethodPut {
		var err error
		id, err = intParam(mux.Vars(r)["id"])
		if err != nil {
			fail(w, 400, "invalid_id", err.Error())
			return
		}
	}
	p := fromContext(r.Context())
	in := userInput{Status: "enabled", PositionIDs: []int{}, RoleIDs: []int{}}
	if id != 0 {
		current, err := f.scopedUser(r, p, id)
		if ent.IsNotFound(err) {
			fail(w, 404, "not_found", "账号不存在")
			return
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		in = userInput{Username: current.Username, Nickname: current.Nickname, Email: current.Email, Phone: current.Phone, Gender: current.Gender, BirthDate: current.BirthDate, Avatar: current.Avatar, DepartmentID: current.DepartmentID, Status: current.Status}
	}
	var patch map[string]json.RawMessage
	if err := decode(r, &patch); err != nil || len(patch) == 0 {
		fail(w, 400, "invalid_request", "账号内容无效")
		return
	}
	positionsChanged := false
	rolesChanged := false
	for key, raw := range patch {
		var err error
		switch key {
		case "username":
			err = json.Unmarshal(raw, &in.Username)
		case "nickname":
			err = json.Unmarshal(raw, &in.Nickname)
		case "password":
			if id != 0 {
				fail(w, 400, "invalid_request", "修改密码请使用专用接口")
				return
			}
			err = json.Unmarshal(raw, &in.Password)
		case "email":
			err = json.Unmarshal(raw, &in.Email)
		case "phone":
			err = json.Unmarshal(raw, &in.Phone)
		case "gender":
			err = json.Unmarshal(raw, &in.Gender)
		case "birthDate":
			err = json.Unmarshal(raw, &in.BirthDate)
		case "avatar":
			err = json.Unmarshal(raw, &in.Avatar)
		case "departmentId":
			err = json.Unmarshal(raw, &in.DepartmentID)
		case "positionIds":
			positionsChanged = true
			err = json.Unmarshal(raw, &in.PositionIDs)
		case "roleIds":
			rolesChanged = true
			err = json.Unmarshal(raw, &in.RoleIDs)
		case "status":
			err = json.Unmarshal(raw, &in.Status)
		default:
			fail(w, 400, "invalid_request", "未知字段")
			return
		}
		if err != nil {
			fail(w, 400, "invalid_request", "字段格式无效")
			return
		}
	}
	if id != 0 && rolesChanged && p.SuperAdmin {
		protected, err := f.protectedBatchUser(r, id)
		if err != nil {
			fail(w, 503, "database_unavailable", "账号查询失败")
			return
		}
		if protected {
			currentIDs, err := f.Store.Client.UserRole.Query().Where(userrole.UserIDEQ(id)).Select(userrole.FieldRoleID).Ints(r.Context())
			if err != nil {
				fail(w, 503, "database_unavailable", "角色查询失败")
				return
			}
			same := len(currentIDs) == len(in.RoleIDs)
			set := map[int]bool{}
			for _, value := range currentIDs {
				set[value] = true
			}
			for _, value := range in.RoleIDs {
				if !set[value] {
					same = false
				}
			}
			if same {
				rolesChanged = false
				in.RoleIDs = nil
			}
		}
	}
	if err := validateUser(in, id == 0); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	if id == 0 {
		if err := f.validatePassword(r.Context(), in.Password); err != nil {
			fail(w, 400, "invalid_password", err.Error())
			return
		}
	}
	if err := f.validateUserRelations(r, p, in); err != nil {
		fail(w, 400, "invalid_relation", err.Error())
		return
	}
	if id != 0 {
		protected, err := f.protectedBatchUser(r, id)
		if err != nil {
			fail(w, 503, "database_unavailable", "账号查询失败")
			return
		}
		if protected && (!p.SuperAdmin || in.Status != "enabled" || rolesChanged) {
			fail(w, 409, "protected_user", "不能修改系统超级管理员状态或授权")
			return
		}
		if id == p.User.ID && in.Status != "enabled" {
			fail(w, 409, "protected_user", "不能停用当前账号")
			return
		}
	}
	var hash []byte
	if id == 0 {
		var err error
		hash, err = bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
		if err != nil {
			fail(w, 500, "password_error", "密码处理失败")
			return
		}
	}
	var saved *ent.User
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		if id == 0 {

			create := tx.User.Create()
			applyUserCreate(create, in, p, hash)
			saved, err = create.Save(r.Context())
		} else {
			update := tx.User.UpdateOneID(id)
			applyUserUpdate(update, in)
			saved, err = update.Save(r.Context())
		}
		if err != nil {
			return err
		}
		if positionsChanged || id == 0 {
			if _, err = tx.UserPosition.Delete().Where(userposition.UserIDEQ(saved.ID)).Exec(r.Context()); err != nil {
				return err
			}
			for _, positionID := range in.PositionIDs {
				if err = tx.UserPosition.Create().SetUserID(saved.ID).SetPositionID(positionID).Exec(r.Context()); err != nil {
					return err
				}
			}
		}
		if rolesChanged || id == 0 {
			if _, err = tx.UserRole.Delete().Where(userrole.UserIDEQ(saved.ID)).Exec(r.Context()); err != nil {
				return err
			}
			for _, roleID := range in.RoleIDs {
				if err = tx.UserRole.Create().SetUserID(saved.ID).SetRoleID(roleID).Exec(r.Context()); err != nil {
					return err
				}
			}
		}
		if in.Status == "disabled" {
			if _, err := tx.Session.Update().Where(session.UserIDEQ(saved.ID), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(r.Context()); err != nil {
				return err
			}
		}
		if err := f.syncDynamicGroupsInTx(r.Context(), tx, p); err != nil {
			return err
		}
		operation := "update"
		if id == 0 {
			operation = "create"
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation(operation).SetResource("users").SetResourceID(saved.ID)

		return log.Exec(r.Context())
	})

	if err != nil {
		fail(w, 409, "user_conflict", err.Error())
		return
	}
	view, err := f.userView(r, saved)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, view)
}

func (f *Framework) resetUserPassword(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	var in struct {
		Password string `json:"password"`
	}
	if err := decode(r, &in); err != nil || len(in.Password) < 6 || len(in.Password) > 72 {
		fail(w, 400, "invalid_password", "密码至少 6 位且不超过 72 字节")
		return
	}
	if err := f.validatePassword(r.Context(), in.Password); err != nil {
		fail(w, 400, "invalid_password", err.Error())
		return
	}
	p := fromContext(r.Context())
	if _, err := f.scopedUser(r, p, id); err != nil {
		fail(w, 404, "not_found", "账号不存在")
		return
	}
	protected, err := f.protectedBatchUser(r, id)
	if err != nil {
		fail(w, 503, "database_unavailable", "账号查询失败")
		return
	}
	if protected && !p.SuperAdmin {
		fail(w, 403, "protected_user", "不能重置系统超级管理员密码")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		fail(w, 500, "password_error", "密码处理失败")
		return
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if err := tx.User.UpdateOneID(id).SetPasswordHash(string(hash)).SetPasswordUpdatedAt(time.Now()).Exec(r.Context()); err != nil {
			return err
		}
		if _, err := tx.Session.Update().Where(session.UserIDEQ(id), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(r.Context()); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("reset_password").SetResource("users").SetResourceID(id)

		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "重置密码失败")
		return
	}
	respond(w, 200, nil)
}

func (f *Framework) deleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	if id == p.User.ID {
		fail(w, 409, "self_delete", "不能删除当前账号")
		return
	}
	_, err = f.scopedUser(r, p, id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "账号不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	ids, err := f.effectiveRoleIDs(r.Context(), id)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	for _, roleID := range ids {
		row, err := f.Store.Client.Role.Get(r.Context(), roleID)
		if err == nil && row.Code == "super_admin" {
			fail(w, 409, "protected_user", "不能删除系统超级管理员")
			return
		}
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if err := tx.User.DeleteOneID(id).Exec(r.Context()); err != nil {
			return err
		}
		if err := f.syncDynamicGroupsInTx(r.Context(), tx, p); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("delete").SetResource("users").SetResourceID(id)

		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "删除失败")
		return
	}
	respond(w, 200, nil)
}
