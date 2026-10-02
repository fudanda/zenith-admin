package organization

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/fudanda/arcbase/backend/ent"
	"github.com/fudanda/arcbase/backend/ent/department"
	"github.com/fudanda/arcbase/backend/ent/loginattempt"
	"github.com/fudanda/arcbase/backend/ent/loginlog"
	"github.com/fudanda/arcbase/backend/ent/position"
	"github.com/fudanda/arcbase/backend/ent/predicate"
	"github.com/fudanda/arcbase/backend/ent/session"
	"github.com/fudanda/arcbase/backend/ent/user"
	"github.com/fudanda/arcbase/backend/ent/userposition"
	"github.com/fudanda/arcbase/backend/ent/userrole"
	"github.com/fudanda/arcbase/backend/internal/data"
	"github.com/fudanda/arcbase/backend/internal/kernel"
	"github.com/fudanda/arcbase/backend/internal/validation"
	"golang.org/x/crypto/bcrypt"
)

type Dependencies struct {
	ScopedPosition func(context.Context, *kernel.Principal, int) (*ent.Position, error)

	MemberSummary         func(ctx context.Context, p *kernel.Principal, query *ent.UserQuery) (int, []map[string]any, error)
	VisibleUser           func(ctx context.Context, p *kernel.Principal, id int) (*ent.User, error)
	SyncDynamicGroupsInTx func(ctx context.Context, tx *ent.Tx, actor *kernel.Principal) error
	WriteMemberPreview    func(ctx context.Context, inArgs kernel.Input, query *ent.UserQuery) (kernel.Outcome, error)
	UserDataPredicate     func(ctx context.Context, p *kernel.Principal) (predicate.User, error)
	SecurityPolicy        func(ctx context.Context) (kernel.SecurityPolicy, error)
	ValidateGrantRoles    func(ctx context.Context, p *kernel.Principal, ids []int) error
	ValidatePassword      func(ctx context.Context, password string) error
	EffectiveRoleIDs      func(ctx context.Context, userID int) ([]int, error)
	UserGrantTarget       func(context.Context,
		kernel.
			Input) (*ent.User, int, error)
}

type Service struct {
	Store *data.Store
	deps  Dependencies
}

func NewService(store *data.Store, deps Dependencies) *Service {
	return &Service{Store: store, deps: deps}
}

type departmentInput struct {
	ParentID int     `json:"parentId"`
	Name     string  `json:"name"`
	Code     string  `json:"code"`
	Category string  `json:"category"`
	LeaderID *int    `json:"leaderId"`
	Phone    *string `json:"phone"`
	Email    *string `json:"email"`
	Sort     int     `json:"sort"`
	Status   string  `json:"status"`
}

func validateDepartment(in departmentInput) error {
	if in.ParentID < 0 {
		return errors.New("上级部门无效")
	}
	if len([]rune(strings.TrimSpace(in.Name))) == 0 || len([]rune(in.Name)) > 64 {
		return errors.New("部门名称无效")
	}
	if len(in.Code) == 0 || len(in.Code) > 64 || !validation.BusinessCode(in.Code) {
		return errors.New("部门编码无效")
	}
	if in.Category == "" {
		return errors.New("部门类别无效")
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("状态无效")
	}
	if in.LeaderID != nil && *in.LeaderID < 1 {
		return errors.New("负责人无效")
	}
	return nil
}

var errBatchUserMissing = errors.New("部分账号不存在或不在当前可操作范围")

var errBatchUserProtected = errors.New("不能批量删除或停用当前账号、系统超级管理员")

func (f *Service) DepartmentView(ctx context.Context, inArgs kernel.Input, row *ent.Department) (map[string]any, error) {
	count, preview, err := f.deps.MemberSummary(ctx, kernel.FromContext(ctx), f.Store.Client.User.Query().Where(user.DepartmentIDEQ(row.ID)))
	if err != nil {
		return nil, err
	}
	var leaderName *string
	if row.LeaderID != nil {
		leader, err := f.deps.VisibleUser(ctx, kernel.FromContext(ctx), *row.LeaderID)
		if err == nil {
			leaderName = &leader.Nickname
		} else if !ent.IsNotFound(err) {
			return nil, err
		}
	}
	view := map[string]any{"id": row.ID, "parentId": row.ParentID, "name": row.Name, "code": row.Code, "category": row.Category, "leaderId": row.LeaderID, "leaderName": leaderName,
		"sort": row.Sort, "status": row.Status, "userCount": count, "userPreview": preview, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}
	if row.Phone != nil {
		view["phone"] = *row.Phone
	}
	if row.Email != nil {
		view["email"] = *row.Email
	}
	return view, nil
}

func (f *Service) DepartmentRows(ctx context.Context, inArgs kernel.Input, p *kernel.Principal) ([]*ent.Department, error) {
	return f.Store.Client.Department.Query().Where(kernel.DepartmentScope(p)).Order(ent.Asc(department.FieldSort), ent.Asc(department.FieldID)).All(ctx)
}

func (f *Service) FilteredDepartments(p *kernel.Principal, q kernel.Values) (*ent.DepartmentQuery, error) {
	query := f.Store.Client.Department.Query().Where(kernel.DepartmentScope(p))
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(department.Or(department.NameContains(keyword), department.CodeContains(keyword)))
	}
	if status := q.Get("status"); status != "" {
		if status != "enabled" && status != "disabled" {
			return nil, errors.New("状态无效")
		}
		query = query.Where(department.StatusEQ(status))
	}
	return query.Order(ent.Asc(department.FieldSort), ent.Asc(department.FieldID)), nil
}

func (f *Service) FlatDepartments(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	return f.departmentList(ctx, inArgs, false)
}

// PagedDepartments is the bounded read port for external integrations; the
// original department tree and selector retain their unpaged contract.
func (f *Service) PagedDepartments(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	return f.departmentList(ctx, inArgs, true)
}

func (f *Service) departmentList(ctx context.Context, inArgs kernel.Input, paged bool) (kernel.Outcome, error) {
	query, err := f.FilteredDepartments(kernel.FromContext(ctx), inArgs.Filter)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	if paged {
		page, _ := strconv.Atoi(inArgs.Filter.Get("page"))
		size, _ := strconv.Atoi(inArgs.Filter.Get("pageSize"))
		if page < 1 || size < 1 || size > 100 {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_query", "分页无效")
		}
		query = query.Offset((page - 1) * size).Limit(size)
	}
	rows, err := query.All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.DepartmentView(ctx, inArgs, row)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		list = append(list, view)
	}
	return kernel.Success(200, list)
}

func (f *Service) ExportDepartmentsCSV(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	query, err := f.FilteredDepartments(kernel.FromContext(ctx), inArgs.Filter)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	return kernel.CSV("departments.csv", []string{"ID", "部门名称", "部门编码", "类别", "负责人", "电话", "状态", "创建时间"}, func(offset int) ([][]string, error) {
		rows, err := query.Clone().Offset(offset).Limit(200).All(ctx)
		if err != nil {
			return nil, err
		}
		result := make([][]string, 0, len(rows))
		for _, row := range rows {
			leaderName, phone := "", ""
			if row.LeaderID != nil {
				leader, err := f.Store.Client.User.Get(ctx, *row.LeaderID)
				if err != nil && !ent.IsNotFound(err) {
					return nil, err
				}
				if err == nil {
					leaderName = leader.Nickname
				}
			}
			if row.Phone != nil {
				phone = *row.Phone
			}
			result = append(result, []string{strconv.Itoa(row.ID), row.Name, row.Code, row.Category, leaderName, phone, row.Status, row.CreatedAt.Format(time.RFC3339)})
		}
		return result, nil
	})
}

func (f *Service) TreeDepartments(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	rows, err := f.DepartmentRows(ctx, inArgs, kernel.FromContext(ctx))
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	keyword := strings.ToLower(strings.TrimSpace(inArgs.Filter.Get("keyword")))
	status := inArgs.Filter.Get("status")
	byID := map[int]map[string]any{}
	ordered := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.DepartmentView(ctx, inArgs, row)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		view["children"] = []any{}
		byID[row.ID] = view
		ordered = append(ordered, view)
	}
	roots := make([]any, 0)
	for _, item := range ordered {
		parentID := item["parentId"].(int)
		if parent, ok := byID[parentID]; ok {
			parent["children"] = append(parent["children"].([]any), item)
		} else {
			roots = append(roots, item)
		}
	}
	var filter func(map[string]any) (map[string]any, bool)
	filter = func(item map[string]any) (map[string]any, bool) {
		children := make([]any, 0)
		for _, child := range item["children"].([]any) {
			if kept, ok := filter(child.(map[string]any)); ok {
				children = append(children, kept)
			}
		}
		match := (keyword == "" || strings.Contains(strings.ToLower(item["name"].(string)+" "+item["code"].(string)), keyword)) && (status == "" || item["status"] == status)
		if !match && len(children) == 0 {
			return nil, false
		}
		item["children"] = children
		return item, true
	}
	result := make([]any, 0)
	for _, root := range roots {
		if kept, ok := filter(root.(map[string]any)); ok {
			result = append(result, kept)
		}
	}
	return kernel.Success(200, result)
}

func (f *Service) GetDepartment(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	row, err := f.Store.Client.Department.Query().Where(department.IDEQ(id), kernel.DepartmentScope(kernel.FromContext(ctx))).Only(ctx)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "部门不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	view, err := f.DepartmentView(ctx, inArgs, row)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, view)
}

func (f *Service) ValidateDepartmentRelations(ctx context.Context, inArgs kernel.Input, p *kernel.Principal, id int, in departmentInput) error {
	if in.ParentID == id && id != 0 {
		return errors.New("部门不能成为自己的上级")
	}
	seen := map[int]bool{}
	for current := in.ParentID; current != 0; {
		if current == id || seen[current] {
			return errors.New("部门层级形成循环")
		}
		seen[current] = true
		parent, err := f.Store.Client.Department.Query().Where(department.IDEQ(current), kernel.DepartmentScope(p)).Only(ctx)
		if err != nil {
			return errors.New("上级部门不存在")
		}
		current = parent.ParentID
	}
	if in.LeaderID != nil {
		_, err := f.Store.Client.User.Get(ctx, *in.LeaderID)
		if err != nil {
			return errors.New("负责人不属于当前组织")
		}
	}
	return nil
}

func (f *Service) SaveDepartment(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id := 0
	if inArgs.Update {
		var err error
		id, err = kernel.IntParam(inArgs.Id)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
		}
	}
	p := kernel.FromContext(ctx)
	in := departmentInput{Category: "department", Status: "enabled"}
	if id != 0 {
		current, err := f.Store.Client.Department.Query().Where(department.IDEQ(id), kernel.DepartmentScope(p)).Only(ctx)
		if ent.IsNotFound(err) {
			return kernel.Outcome{}, kernel.Fail(404, "not_found", "部门不存在")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		in = departmentInput{ParentID: current.ParentID, Name: current.Name, Code: current.Code, Category: current.Category, LeaderID: current.LeaderID, Phone: current.Phone, Email: current.Email, Sort: current.Sort, Status: current.Status}
	}
	var patch map[string]json.RawMessage
	if err := kernel.DecodeBody(inArgs.Body, &patch); err != nil || len(patch) == 0 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "部门内容无效")
	}
	for key, raw := range patch {
		var err error
		switch key {
		case "parentId":
			err = json.Unmarshal(raw, &in.ParentID)
		case "name":
			err = json.Unmarshal(raw, &in.Name)
		case "code":
			err = json.Unmarshal(raw, &in.Code)
		case "category":
			err = json.Unmarshal(raw, &in.Category)
		case "leaderId":
			err = json.Unmarshal(raw, &in.LeaderID)
		case "phone":
			err = json.Unmarshal(raw, &in.Phone)
		case "email":
			err = json.Unmarshal(raw, &in.Email)
		case "sort":
			err = json.Unmarshal(raw, &in.Sort)
		case "status":
			err = json.Unmarshal(raw, &in.Status)
		default:
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "未知字段")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "字段格式无效")
		}
	}
	if err := validateDepartment(in); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", err.Error())
	}
	if err := f.ValidateDepartmentRelations(ctx, inArgs, p, id, in); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_relation", err.Error())
	}
	var saved *ent.Department
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		var err error
		if id == 0 {
			create := tx.Department.Create().SetParentID(in.ParentID).SetName(in.Name).SetCode(in.Code).SetCategory(in.Category).SetSort(in.Sort).SetStatus(in.Status)

			if in.LeaderID != nil {
				create.SetLeaderID(*in.LeaderID)
			}
			if in.Phone != nil {
				create.SetPhone(*in.Phone)
			}
			if in.Email != nil {
				create.SetEmail(*in.Email)
			}
			saved, err = create.Save(ctx)
		} else {
			update := tx.Department.UpdateOneID(id).SetParentID(in.ParentID).SetName(in.Name).SetCode(in.Code).SetCategory(in.Category).SetSort(in.Sort).SetStatus(in.Status)
			if in.LeaderID == nil {
				update.ClearLeaderID()
			} else {
				update.SetLeaderID(*in.LeaderID)
			}
			if in.Phone == nil {
				update.ClearPhone()
			} else {
				update.SetPhone(*in.Phone)
			}
			if in.Email == nil {
				update.ClearEmail()
			} else {
				update.SetEmail(*in.Email)
			}
			saved, err = update.Save(ctx)
		}
		if err != nil {
			return err
		}
		if err := f.deps.SyncDynamicGroupsInTx(ctx, tx, p); err != nil {
			return err
		}
		operation := "update"
		if id == 0 {
			operation = "create"
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation(operation).SetResource("departments").SetResourceID(saved.ID)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "department_conflict", err.Error())
	}
	view, err := f.DepartmentView(ctx, inArgs, saved)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, view)
}

func (f *Service) DeleteDepartment(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		row, err := tx.Department.Query().Where(department.IDEQ(id), kernel.DepartmentScope(p)).Only(ctx)
		if err != nil {
			return err
		}
		children, err := tx.Department.Query().Where(department.ParentIDEQ(id), kernel.DepartmentScope(p)).Exist(ctx)
		if err != nil {
			return err
		}
		if children {
			return errors.New("部门仍有下级")
		}
		members, err := tx.User.Query().Where(user.DepartmentIDEQ(id)).Exist(ctx)
		if err != nil {
			return err
		}
		if members {
			return errors.New("部门仍有成员")
		}
		if err := tx.Department.DeleteOne(row).Exec(ctx); err != nil {
			return err
		}
		if err := f.deps.SyncDynamicGroupsInTx(ctx, tx, p); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("delete").SetResource("departments").SetResourceID(id)

		return log.Exec(ctx)
	})
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "部门不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "department_conflict", err.Error())
	}
	return kernel.Success(200, nil)
}

func (f *Service) DepartmentMemberPreview(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	if _, err = f.Store.Client.Department.Get(ctx, id); ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "部门不存在")
	} else if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	query := f.Store.Client.User.Query().Where(user.DepartmentIDEQ(id))
	return f.deps.WriteMemberPreview(ctx, inArgs, query)
}

func (f *Service) MemberView(ctx context.Context, inArgs kernel.Input, account *ent.User, joinedAt time.Time) map[string]any {
	var departmentName *string
	if account.DepartmentID != nil {
		if department, err := f.Store.Client.Department.Get(ctx, *account.DepartmentID); err == nil {
			departmentName = &department.Name
		}
	}
	return map[string]any{"id": account.ID, "username": account.Username, "nickname": account.Nickname,
		"email": account.Email, "avatar": account.Avatar, "departmentName": departmentName, "joinedAt": joinedAt.Format(time.RFC3339Nano)}
}

func (f *Service) AllUsers(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	query := f.Store.Client.User.Query().Where(user.StatusEQ("enabled"))

	dataScope, err := f.deps.UserDataPredicate(ctx, p)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "数据权限查询失败")
	}
	if dataScope != nil {
		query = query.Where(dataScope)
	}
	rows, err := query.Order(ent.Asc(user.FieldNickname)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	result := make([]map[string]any, 0, len(rows))
	for _, account := range rows {
		view, err := f.UserView(ctx, inArgs, account)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		result = append(result, view)
	}
	return kernel.Success(200, result)
}

func (f *Service) ScopedUser(ctx context.Context, inArgs kernel.Input, p *kernel.Principal, id int) (*ent.User, error) {
	return f.deps.VisibleUser(ctx, p, id)
}

func (f *Service) UserView(ctx context.Context, inArgs kernel.Input, account *ent.User) (map[string]any, error) {
	var departmentName *string
	if account.DepartmentID != nil {
		dept, err := f.Store.Client.Department.Get(ctx, *account.DepartmentID)
		if err == nil {
			departmentName = &dept.Name
		} else if !ent.IsNotFound(err) {
			return nil, err
		}
	}
	ids, err := f.Store.Client.UserRole.Query().Where(userrole.UserIDEQ(account.ID)).Select(userrole.FieldRoleID).Ints(ctx)
	if err != nil {
		return nil, err
	}
	roles := make([]any, 0, len(ids))
	for _, id := range ids {
		row, err := f.Store.Client.Role.Get(ctx, id)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		roles = append(roles, map[string]any{"id": row.ID, "name": row.Name, "code": row.Code, "dataScope": row.DataScope, "status": row.Status, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt})
	}
	links, err := f.Store.Client.UserPosition.Query().Where(userposition.UserIDEQ(account.ID)).All(ctx)
	if err != nil {
		return nil, err
	}
	positionIDs := make([]int, 0, len(links))
	for _, link := range links {
		positionIDs = append(positionIDs, link.PositionID)
	}
	positions := make([]map[string]any, 0, len(positionIDs))
	for _, id := range positionIDs {
		position, err := f.Store.Client.Position.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		positions = append(positions, map[string]any{"id": position.ID, "name": position.Name, "code": position.Code, "sort": position.Sort, "status": position.Status, "createdAt": position.CreatedAt, "updatedAt": position.UpdatedAt})
	}
	online, err := f.Store.Client.Session.Query().Where(session.UserIDEQ(account.ID), session.RevokedAtIsNil(), session.ExpiresAtGT(time.Now())).Order(ent.Desc(session.FieldLastActiveAt)).First(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	var lastActive *time.Time
	if online != nil {
		lastActive = &online.LastActiveAt
	}
	latest, err := f.Store.Client.LoginLog.Query().Where(loginlog.UserIDEQ(account.ID), loginlog.SuccessEQ(true)).Order(ent.Desc(loginlog.FieldCreatedAt)).First(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	var lastLogin *time.Time
	var loginIP *string
	if latest != nil {
		lastLogin = &latest.CreatedAt
		loginIP = &latest.IP
	}
	defense, err := f.Store.Client.LoginAttempt.Query().Where(loginattempt.UsernameHashEQ(kernel.UsernameHash(account.Username)), loginattempt.LockedUntilGT(time.Now())).First(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	policy, err := f.deps.SecurityPolicy(ctx)
	if err != nil {
		return nil, err
	}
	expired := policy.Password.ExpiryEnabled && account.PasswordUpdatedAt.AddDate(0, 0, policy.Password.ExpiryDays).Before(time.Now())
	return map[string]any{"id": account.ID, "username": account.Username, "nickname": account.Nickname, "email": account.Email, "phone": account.Phone, "gender": account.Gender, "birthDate": account.BirthDate,
		"avatar": account.Avatar, "departmentId": account.DepartmentID, "departmentName": departmentName, "positionIds": positionIDs, "positions": positions, "roles": roles, "isOnline": online != nil, "lastActiveAt": lastActive, "lastLoginAt": lastLogin, "lastLoginIp": loginIP, "loginChallengeRequired": defense != nil && defense.Failures > 0,
		"status": account.Status, "requirePasswordChange": expired, "passwordUpdatedAt": account.PasswordUpdatedAt, "createdAt": account.CreatedAt, "updatedAt": account.UpdatedAt}, nil
}

func (f *Service) ListUsers(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	q := inArgs.Filter
	page, err := kernel.PositiveInt(q.Get("page"), 1, 1000000)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_page", err.Error())
	}
	size, err := kernel.PositiveInt(q.Get("pageSize"), 10, 200)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_page_size", err.Error())
	}
	query, err := f.FilteredUsers(ctx, inArgs, p, q)
	if errors.Is(err, kernel.ErrUserFilter) {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "数据权限查询失败")
	}
	total, err := query.Clone().Count(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	rows, err := query.Offset((page - 1) * size).Limit(size).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(rows))
	for _, account := range rows {
		view, err := f.UserView(ctx, inArgs, account)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		list = append(list, view)
	}
	return kernel.Success(200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Service) FilteredUsers(ctx context.Context, inArgs kernel.Input, p *kernel.Principal, q kernel.Values) (*ent.UserQuery, error) {
	query := f.Store.Client.User.Query().Where(kernel.UserScope(p))
	dataScope, err := f.deps.UserDataPredicate(ctx, p)
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
			return nil, fmt.Errorf("%w: 状态无效", kernel.ErrUserFilter)
		}
		query = query.Where(user.StatusEQ(status))
	}
	if raw := q.Get("departmentId"); raw != "" {
		id, err := kernel.IntParam(raw)
		if err != nil {
			return nil, fmt.Errorf("%w: 部门 ID 无效", kernel.ErrUserFilter)
		}
		query = query.Where(user.DepartmentIDEQ(id))
	}
	for _, bound := range []struct {
		key string
		end bool
	}{{"startTime", false}, {"endTime", true}} {
		if raw := q.Get(bound.key); raw != "" {
			value, err := validation.DateBound(raw, bound.end)
			if err != nil {
				return nil, fmt.Errorf("%w: %s", kernel.ErrUserFilter, err)
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

func (f *Service) GetUser(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	account, err := f.ScopedUser(ctx, inArgs, kernel.FromContext(ctx), id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "账号不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	view, err := f.UserView(ctx, inArgs, account)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, view)
}

func (f *Service) ValidateUserRelations(ctx context.Context, inArgs kernel.Input, p *kernel.Principal, in kernel.UserInput) error {
	return f.ValidateUserRelationsContext(ctx, p, in)
}

func (f *Service) ValidateUserRelationsContext(ctx context.Context, p *kernel.Principal, in kernel.UserInput) error {
	if in.DepartmentID != nil {
		if _, err := f.Store.Client.Department.Query().Where(department.IDEQ(*in.DepartmentID), kernel.DepartmentScope(p)).Only(ctx); err != nil {
			return errors.New("部门不存在")
		}
	}
	seen := map[int]bool{}
	for _, id := range in.PositionIDs {
		if id < 1 || seen[id] {
			return errors.New("岗位 ID 无效或重复")
		}
		seen[id] = true
		if _, err := f.deps.ScopedPosition(ctx, p, id); err != nil {
			return errors.New("岗位不存在")
		}
	}
	if err := f.deps.ValidateGrantRoles(ctx, p, in.RoleIDs); err != nil {
		return err
	}

	return nil
}

func (f *Service) SaveUser(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id := 0
	if inArgs.Update {
		var err error
		id, err = kernel.IntParam(inArgs.Id)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
		}
	}
	p := kernel.FromContext(ctx)
	in := kernel.UserInput{Status: "enabled", PositionIDs: []int{}, RoleIDs: []int{}}
	if id != 0 {
		current, err := f.ScopedUser(ctx, inArgs, p, id)
		if ent.IsNotFound(err) {
			return kernel.Outcome{}, kernel.Fail(404, "not_found", "账号不存在")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		in = kernel.UserInput{Username: current.Username, Nickname: current.Nickname, Email: current.Email, Phone: current.Phone, Gender: current.Gender, BirthDate: current.BirthDate, Avatar: current.Avatar, DepartmentID: current.DepartmentID, Status: current.Status}
	}
	var patch map[string]json.RawMessage
	if err := kernel.DecodeBody(inArgs.Body, &patch); err != nil || len(patch) == 0 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "账号内容无效")
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
				return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "修改密码请使用专用接口")
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
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "未知字段")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "字段格式无效")
		}
	}
	if id != 0 && rolesChanged && p.SuperAdmin {
		protected, err := f.ProtectedBatchUser(ctx, inArgs, id)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "账号查询失败")
		}
		if protected {
			currentIDs, err := f.Store.Client.UserRole.Query().Where(userrole.UserIDEQ(id)).Select(userrole.FieldRoleID).Ints(ctx)
			if err != nil {
				return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "角色查询失败")
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
	if err := kernel.ValidateUser(in, id == 0); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", err.Error())
	}
	if id == 0 {
		if err := f.deps.ValidatePassword(ctx, in.Password); err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_password", err.Error())
		}
	}
	if err := f.ValidateUserRelations(ctx, inArgs, p, in); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_relation", err.Error())
	}
	if id != 0 {
		protected, err := f.ProtectedBatchUser(ctx, inArgs, id)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "账号查询失败")
		}
		if protected && (!p.SuperAdmin || in.Status != "enabled" || rolesChanged) {
			return kernel.Outcome{}, kernel.Fail(409, "protected_user", "不能修改系统超级管理员状态或授权")
		}
		if id == p.User.ID && in.Status != "enabled" {
			return kernel.Outcome{}, kernel.Fail(409, "protected_user", "不能停用当前账号")
		}
	}
	var hash []byte
	if id == 0 {
		var err error
		hash, err = bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(500, "password_error", "密码处理失败")
		}
	}
	var saved *ent.User
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		var err error
		if id == 0 {

			create := tx.User.Create()
			kernel.ApplyUserCreate(create, in, p, hash)
			saved, err = create.Save(ctx)
		} else {
			update := tx.User.UpdateOneID(id)
			kernel.ApplyUserUpdate(update, in)
			saved, err = update.Save(ctx)
		}
		if err != nil {
			return err
		}
		if positionsChanged || id == 0 {
			if _, err = tx.UserPosition.Delete().Where(userposition.UserIDEQ(saved.ID)).Exec(ctx); err != nil {
				return err
			}
			for _, positionID := range in.PositionIDs {
				if err = tx.UserPosition.Create().SetUserID(saved.ID).SetPositionID(positionID).Exec(ctx); err != nil {
					return err
				}
			}
		}
		if rolesChanged || id == 0 {
			if _, err = tx.UserRole.Delete().Where(userrole.UserIDEQ(saved.ID)).Exec(ctx); err != nil {
				return err
			}
			for _, roleID := range in.RoleIDs {
				if err = tx.UserRole.Create().SetUserID(saved.ID).SetRoleID(roleID).Exec(ctx); err != nil {
					return err
				}
			}
		}
		if in.Status == "disabled" {
			if _, err := tx.Session.Update().Where(session.UserIDEQ(saved.ID), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(ctx); err != nil {
				return err
			}
		}
		if err := f.deps.SyncDynamicGroupsInTx(ctx, tx, p); err != nil {
			return err
		}
		operation := "update"
		if id == 0 {
			operation = "create"
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation(operation).SetResource("users").SetResourceID(saved.ID)

		return log.Exec(ctx)
	})

	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "user_conflict", err.Error())
	}
	view, err := f.UserView(ctx, inArgs, saved)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, view)
}

func (f *Service) ResetUserPassword(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	var in struct {
		Password string `json:"password"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || len(in.Password) < 6 || len(in.Password) > 72 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_password", "密码至少 6 位且不超过 72 字节")
	}
	if err := f.deps.ValidatePassword(ctx, in.Password); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_password", err.Error())
	}
	p := kernel.FromContext(ctx)
	if _, err := f.ScopedUser(ctx, inArgs, p, id); err != nil {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "账号不存在")
	}
	protected, err := f.ProtectedBatchUser(ctx, inArgs, id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "账号查询失败")
	}
	if protected && !p.SuperAdmin {
		return kernel.Outcome{}, kernel.Fail(403, "protected_user", "不能重置系统超级管理员密码")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(500, "password_error", "密码处理失败")
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if err := tx.User.UpdateOneID(id).SetPasswordHash(string(hash)).SetPasswordUpdatedAt(time.Now()).Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.Session.Update().Where(session.UserIDEQ(id), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(ctx); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("reset_password").SetResource("users").SetResourceID(id)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "重置密码失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) DeleteUser(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	if id == p.User.ID {
		return kernel.Outcome{}, kernel.Fail(409, "self_delete", "不能删除当前账号")
	}
	_, err = f.ScopedUser(ctx, inArgs, p, id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "账号不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	ids, err := f.deps.EffectiveRoleIDs(ctx, id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	for _, roleID := range ids {
		row, err := f.Store.Client.Role.Get(ctx, roleID)
		if err == nil && row.Code == "super_admin" {
			return kernel.Outcome{}, kernel.Fail(409, "protected_user", "不能删除系统超级管理员")
		}
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if err := tx.User.DeleteOneID(id).Exec(ctx); err != nil {
			return err
		}
		if err := f.deps.SyncDynamicGroupsInTx(ctx, tx, p); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("delete").SetResource("users").SetResourceID(id)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "删除失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) ProtectedBatchUser(ctx context.Context, inArgs kernel.Input, id int) (bool, error) {
	ids, err := f.deps.EffectiveRoleIDs(ctx, id)
	if err != nil {
		return false, err
	}
	for _, roleID := range ids {
		row, err := f.Store.Client.Role.Get(ctx, roleID)
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

func (f *Service) BatchUsers(ctx context.Context, inArgs kernel.Input, ids []int, status *string) (kernel.Outcome, error) {
	if !kernel.ValidBatchUserIDs(ids) {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "请选择 1 至 200 个不同账号")
	}
	if status != nil && *status != "enabled" && *status != "disabled" {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_status", "状态无效")
	}
	p := kernel.FromContext(ctx)
	scope, err := f.deps.UserDataPredicate(ctx, p)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "数据权限查询失败")
	}
	predicates := []predicate.User{user.IDIn(ids...), kernel.UserScope(p)}
	if scope != nil {
		predicates = append(predicates, scope)
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		rows, err := tx.User.Query().Where(predicates...).All(ctx)
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
				protected, err := f.ProtectedBatchUser(ctx, inArgs, row.ID)
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
			count, err := tx.User.Delete().Where(predicates...).Exec(ctx)
			if err != nil {
				return err
			}
			if count != len(ids) {
				return errBatchUserMissing
			}
		} else {
			operation = "status_batch"
			count, err := tx.User.Update().Where(predicates...).SetStatus(*status).Save(ctx)
			if err != nil {
				return err
			}
			if count != len(ids) {
				return errBatchUserMissing
			}
			if *status == "disabled" {
				if _, err := tx.Session.Update().Where(session.UserIDIn(ids...), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(ctx); err != nil {
					return err
				}
			}
		}
		if err := f.deps.SyncDynamicGroupsInTx(ctx, tx, p); err != nil {
			return err
		}
		audit := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation(operation).SetResource("users")

		return audit.Exec(ctx)
	})
	if errors.Is(err, errBatchUserMissing) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", err.Error())
	}
	if errors.Is(err, errBatchUserProtected) {
		return kernel.Outcome{}, kernel.Fail(409, "protected_user", err.Error())
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "批量操作失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) DeleteUsersBatch(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	var in struct {
		IDs []int `json:"ids"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "账号 ID 列表无效")
	}
	return f.BatchUsers(ctx, inArgs, in.IDs, nil)
}

func (f *Service) UpdateUsersStatusBatch(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	var in struct {
		IDs    []int  `json:"ids"`
		Status string `json:"status"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "状态批量请求无效")
	}
	return f.BatchUsers(ctx, inArgs, in.IDs, &in.Status)
}

func (f *Service) ExportUsersCSV(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	query, err := f.FilteredUsers(ctx, inArgs, kernel.FromContext(ctx), inArgs.Filter)
	if errors.Is(err, kernel.ErrUserFilter) {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "数据权限查询失败")
	}
	return kernel.CSV("users.csv", []string{"ID", "用户名", "昵称", "部门", "状态", "邮箱", "手机号", "角色", "岗位", "最后登录时间", "创建时间", "更新时间"}, func(offset int) ([][]string, error) {
		accounts, err := query.Clone().Offset(offset).Limit(200).All(ctx)
		if err != nil {
			return nil, err
		}
		result := make([][]string, 0, len(accounts))
		for _, account := range accounts {
			view, err := f.UserView(ctx, inArgs, account)
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
				rows, err := f.Store.Client.Position.Query().Where(position.IDIn(ids...)).All(ctx)
				if err != nil {
					return nil, err
				}
				for _, row := range rows {
					positionNames = append(positionNames, row.Name)
				}
			}
			lastLogin := ""
			log, err := f.Store.Client.LoginLog.Query().Where(loginlog.UserIDEQ(account.ID), loginlog.SuccessEQ(true)).Order(ent.Desc(loginlog.FieldCreatedAt)).First(ctx)
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
func (f *Service) ResetUsersPasswordBatch(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	var in struct {
		IDs      []int  `json:"ids"`
		Password string `json:"password"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || !kernel.ValidBatchUserIDs(in.IDs) || len(in.Password) < 6 || len(in.Password) > 72 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "账号或密码无效")
	}
	if err := f.deps.ValidatePassword(ctx, in.Password); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_password", err.Error())
	}
	p := kernel.FromContext(ctx)
	for _, id := range in.IDs {
		if _, err := f.deps.VisibleUser(ctx, p, id); err != nil {
			return kernel.Outcome{}, kernel.Fail(404, "not_found", "账号不在可管理范围")
		}
		protected, err := f.ProtectedBatchUser(ctx, inArgs, id)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "授权查询失败")
		}
		if protected && !p.SuperAdmin {
			return kernel.Outcome{}, kernel.Fail(403, "protected_user", "不能重置系统超级管理员密码")
		}
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(500, "password_error", "密码处理失败")
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if _, err := tx.User.Update().Where(user.IDIn(in.IDs...)).SetPasswordHash(string(hash)).SetPasswordUpdatedAt(time.Now()).Save(ctx); err != nil {
			return err
		}
		if _, err := tx.Session.Update().Where(session.UserIDIn(in.IDs...), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(ctx); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("reset_password_batch").SetResource("users").Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "密码重置失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) UnlockUser(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	account, id, targetErr := f.deps.UserGrantTarget(ctx, inArgs)
	if targetErr != nil {
		return kernel.Outcome{}, targetErr
	}
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if _, err := tx.LoginAttempt.Delete().Where(loginattempt.UsernameHashEQ(kernel.UsernameHash(account.Username))).Exec(ctx); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(kernel.FromContext(ctx).User.ID).SetRequestID(inArgs.TraceID).SetOperation("unlock").SetResource("users").SetResourceID(id).Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "清除登录防护失败")
	}
	return kernel.Success(200, nil)
}
