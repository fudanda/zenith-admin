package zenith

import (
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
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/session"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/ent/userposition"
	"github.com/fudanda/zenith-admin/backend/ent/userrole"
	"github.com/gorilla/mux"
	"golang.org/x/crypto/bcrypt"
)

var phonePattern = regexp.MustCompile(`^1[3-9][0-9]{9}$`)

func userScope(p *principal) predicate.User {
	if p.TenantID == nil {
		return user.TenantIDIsNil()
	}
	return user.TenantIDEQ(*p.TenantID)
}

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
	ids, err := f.effectiveRoleIDs(r.Context(), account.ID)
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
		roles = append(roles, map[string]any{"id": row.ID, "name": row.Name, "code": row.Code, "dataScope": row.DataScope, "tenantId": row.TenantID, "status": row.Status, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt})
	}
	links, err := f.Store.Client.UserPosition.Query().Where(userposition.UserIDEQ(account.ID)).All(r.Context())
	if err != nil {
		return nil, err
	}
	positionIDs := make([]int, 0, len(links))
	for _, link := range links {
		positionIDs = append(positionIDs, link.PositionID)
	}
	return map[string]any{"id": account.ID, "username": account.Username, "nickname": account.Nickname, "email": account.Email, "phone": account.Phone, "gender": account.Gender, "birthDate": account.BirthDate,
		"avatar": account.Avatar, "departmentId": account.DepartmentID, "departmentName": departmentName, "tenantId": account.TenantID, "positionIds": positionIDs, "roles": roles,
		"status": account.Status, "passwordUpdatedAt": account.PasswordUpdatedAt, "createdAt": account.CreatedAt, "updatedAt": account.UpdatedAt}, nil
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
	if creating && (len(in.Password) < 12 || len(in.Password) > 72) {
		return errors.New("密码至少 12 位且不超过 72 位")
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
	if in.DepartmentID != nil {
		if _, err := f.Store.Client.Department.Query().Where(department.IDEQ(*in.DepartmentID), departmentScope(p)).Only(r.Context()); err != nil {
			return errors.New("部门不存在")
		}
	}
	seen := map[int]bool{}
	for _, id := range in.PositionIDs {
		if id < 1 || seen[id] {
			return errors.New("岗位 ID 无效或重复")
		}
		seen[id] = true
		if _, err := f.scopedPosition(r.Context(), p, id); err != nil {
			return errors.New("岗位不存在")
		}
	}
	seen = map[int]bool{}
	for _, id := range in.RoleIDs {
		if id < 1 || seen[id] {
			return errors.New("角色 ID 无效或重复")
		}
		seen[id] = true
		row, err := f.Store.Client.Role.Query().Where(role.IDEQ(id), role.StatusEQ("enabled")).Only(r.Context())
		if err != nil {
			return errors.New("角色不存在")
		}
		if (row.TenantID == nil) != (p.TenantID == nil) || p.TenantID != nil && *row.TenantID != *p.TenantID {
			return errors.New("跨租户角色")
		}
	}
	return nil
}

func applyUserCreate(create *ent.UserCreate, in userInput, p *principal, hash []byte) {
	create.SetUsername(in.Username).SetNickname(in.Nickname).SetPasswordHash(string(hash)).SetStatus(in.Status)
	if p.TenantID != nil {
		create.SetTenantID(*p.TenantID)
	}
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
	if err := validateUser(in, id == 0); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	if err := f.validateUserRelations(r, p, in); err != nil {
		fail(w, 400, "invalid_relation", err.Error())
		return
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
			if err := reserveTenantSeat(r.Context(), tx, p.TenantID); err != nil {
				return err
			}
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
		if err := syncDynamicGroupsInTx(r.Context(), tx, p.TenantID); err != nil {
			return err
		}
		operation := "update"
		if id == 0 {
			operation = "create"
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation(operation).SetResource("users").SetResourceID(saved.ID)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if errors.Is(err, errTenantSeatLimit) {
		fail(w, 409, "tenant_user_limit", err.Error())
		return
	}
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
	if err := decode(r, &in); err != nil || len(in.Password) < 12 || len(in.Password) > 72 {
		fail(w, 400, "invalid_password", "密码至少 12 位且不超过 72 位")
		return
	}
	p := fromContext(r.Context())
	if _, err := f.scopedUser(r, p, id); err != nil {
		fail(w, 404, "not_found", "账号不存在")
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
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
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
	target, err := f.scopedUser(r, p, id)
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
		if err == nil && row.Code == "super_admin" && row.TenantID == nil && target.TenantID == nil {
			fail(w, 409, "protected_user", "不能删除平台超级管理员")
			return
		}
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if err := tx.User.DeleteOneID(id).Exec(r.Context()); err != nil {
			return err
		}
		if err := syncDynamicGroupsInTx(r.Context(), tx, p.TenantID); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("delete").SetResource("users").SetResourceID(id)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "删除失败")
		return
	}
	respond(w, 200, nil)
}
