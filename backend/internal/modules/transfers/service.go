package transfers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/fudanda/arcbase/backend/ent"
	"github.com/fudanda/arcbase/backend/ent/department"
	"github.com/fudanda/arcbase/backend/ent/position"
	"github.com/fudanda/arcbase/backend/ent/role"
	"github.com/fudanda/arcbase/backend/ent/session"
	"github.com/fudanda/arcbase/backend/ent/user"
	"github.com/fudanda/arcbase/backend/ent/userposition"
	"github.com/fudanda/arcbase/backend/ent/userrole"
	"github.com/fudanda/arcbase/backend/internal/contracts"
	"github.com/fudanda/arcbase/backend/internal/data"
	"github.com/fudanda/arcbase/backend/internal/kernel"
	excelize "github.com/xuri/excelize/v2"
	"golang.org/x/crypto/bcrypt"
)

type Dependencies struct {
	Permits                      func(context.Context, kernel.Input, string) (bool, error)
	Export                       func(context.Context, string, kernel.Input) (kernel.Outcome, error)
	Permissions                  func(ctx context.Context, p *kernel.Principal) ([]string, error)
	VisibleUser                  func(ctx context.Context, p *kernel.Principal, id int) (*ent.User, error)
	ValidatePassword             func(ctx context.Context, password string) error
	ValidateGrantScope           func(ctx context.Context, p *kernel.Principal, scope string, departments []int) error
	ValidateUserRelationsContext func(ctx context.Context, p *kernel.Principal, in kernel.UserInput) error
	SyncDynamicGroupsInTx        func(ctx context.Context, tx *ent.Tx, actor *kernel.Principal) error
	EffectiveRoleIDs             func(ctx context.Context, userID int) ([]int, error)
}

type Service struct {
	Store *data.Store
	deps  Dependencies
}

func NewService(store *data.Store, deps Dependencies) *Service {
	return &Service{Store: store, deps: deps}
}

var UserImportHeaders = []string{"用户名", "昵称", "邮箱", "密码", "部门编码", "岗位编码(逗号)", "角色编码(逗号)", "状态"}

type ImportRow struct {
	Row     int    `json:"row"`
	Label   string `json:"label"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

type ImportResult struct {
	DryRun  bool        `json:"dryRun"`
	Total   int         `json:"total"`
	Success int         `json:"success"`
	Failed  int         `json:"failed"`
	Skipped int         `json:"skipped"`
	Rows    []ImportRow `json:"rows"`
}

func codeList(value string) []string {
	result := []string{}
	for _, code := range strings.Split(strings.ReplaceAll(value, "，", ","), ",") {
		if clean := strings.TrimSpace(code); clean != "" {
			result = append(result, clean)
		}
	}
	return result
}

func (f *Service) UserImportTemplate(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	return kernel.Outcome{Status: 200, Filename: "users-template.xlsx", ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Write: func(writer io.Writer) error {
		book := excelize.NewFile()
		defer book.Close()
		headers := make([]any, len(UserImportHeaders))
		for i, name := range UserImportHeaders {
			headers[i] = name
		}
		if err := book.SetSheetRow("Sheet1", "A1", &headers); err != nil {
			return kernel.Fail(500, "template_failed", "模板生成失败")
		}
		book.SetColWidth("Sheet1", "A", "H", 24)
		return book.Write(writer)
	}}, nil
}

func (f *Service) SyncUserImport(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	dry := inArgs.DryRun
	duplicate := inArgs.Duplicate
	if dry != "true" && dry != "false" || duplicate != "error" && duplicate != "skip" && duplicate != "update" {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "预检或重复处理选项无效")
	}
	file := inArgs.Upload
	if !strings.EqualFold(inArgs.Filename[len(inArgs.Filename)-min(5, len(inArgs.Filename)):], ".xlsx") {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_upload", "仅支持 XLSX 文件")
	}
	book, err := excelize.OpenReader(file, excelize.Options{UnzipSizeLimit: 50 << 20})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_workbook", "XLSX 文件无法读取")
	}
	defer book.Close()
	sheets := book.GetSheetList()
	if len(sheets) == 0 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_workbook", "工作表为空")
	}
	iterator, err := book.Rows(sheets[0])
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_workbook", "工作表无法读取")
	}
	defer iterator.Close()
	if !iterator.Next() {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_header", "缺少模板表头")
	}
	headers, err := iterator.Columns()
	if err != nil || len(headers) != len(UserImportHeaders) {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_header", "表头必须与用户导入模板一致")
	}
	for i, name := range UserImportHeaders {
		if headers[i] != name {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_header", "表头必须与用户导入模板一致")
		}
	}
	data := [][]string{}
	for iterator.Next() {
		row, readErr := iterator.Columns()
		if readErr != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_workbook", "工作表行无法读取")
		}
		data = append(data, row)
		if len(data) > 5000 {
			return kernel.Outcome{}, kernel.Fail(400, "too_many_rows", "同步导入最多 5000 行")
		}
	}
	if iterator.Error() != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_workbook", "工作表读取失败")
	}
	permissions, err := f.deps.Permissions(ctx, kernel.FromContext(ctx))
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "授权查询失败")
	}
	result := f.ImportUsers(ctx, kernel.FromContext(ctx), permissions, inArgs.TraceID, data, dry == "true", duplicate)
	return kernel.Success(200, result)
}

func (f *Service) ImportUsers(ctx context.Context, p *kernel.Principal, permissions []string, trace string, data [][]string, dryRun bool, duplicate string) ImportResult {
	result := ImportResult{DryRun: dryRun, Rows: []ImportRow{}}
	seen := map[string]bool{}
	seenEmails := map[string]bool{}
	canAssign := p.SuperAdmin
	for _, permission := range permissions {
		if permission == "system:user:assign" {
			canAssign = true
		}
	}
	for index, row := range data {
		nonempty := false
		for _, value := range row {
			if strings.TrimSpace(value) != "" {
				nonempty = true
			}
		}
		if !nonempty {
			continue
		}
		result.Total++
		item := ImportRow{Row: index + 2, Status: "failed"}
		columns := make([]string, 8)
		copy(columns, row)
		for i := range columns {
			columns[i] = strings.TrimSpace(columns[i])
		}
		item.Label = columns[0]
		err := func() error {
			if len(row) > 8 {
				return errors.New("列数超出模板")
			}
			if seen[columns[0]] {
				if duplicate == "skip" {
					item.Status = "skipped"
					item.Message = "文件内重复用户名"
					return nil
				}
				return errors.New("文件内用户名重复")
			}
			seen[columns[0]] = true
			in := kernel.UserInput{Username: columns[0], Nickname: columns[1], Password: columns[3], Status: columns[7], PositionIDs: []int{}, RoleIDs: []int{}}
			if in.Nickname == "" {
				in.Nickname = in.Username
			}
			if in.Status == "" {
				in.Status = "enabled"
			}
			if columns[2] != "" {
				in.Email = &columns[2]
			}
			current, err := f.Store.Client.User.Query().Where(user.UsernameEQ(in.Username)).Only(ctx)
			if err != nil && !ent.IsNotFound(err) {
				return errors.New("数据库查询失败")
			}
			updating := current != nil
			if updating {
				if duplicate == "skip" {
					item.Status = "skipped"
					item.Message = "已存在，已跳过"
					return nil
				}
				if duplicate != "update" {
					return errors.New("用户名已存在")
				}
				if _, err = f.deps.VisibleUser(ctx, p, current.ID); err != nil {
					return errors.New("账号不在可修改范围")
				}
				if !canAssign {
					return errors.New("更新现有用户授权需要用户授权权限")
				}
				in.Phone = current.Phone
				in.Gender = current.Gender
				in.BirthDate = current.BirthDate
				in.Avatar = current.Avatar
				root, err := f.ProtectedUserContext(ctx, current.ID)
				if err != nil {
					return errors.New("授权查询失败")
				}
				if root || current.ID == p.User.ID {
					return errors.New("导入不能修改当前账号或超级管理员")
				}
			}
			body := map[string]any{"username": in.Username, "nickname": in.Nickname, "status": in.Status}
			if in.Email != nil {
				body["email"] = *in.Email
			}
			if !updating {
				body["password"] = in.Password
			}
			definition := contracts.RequestDefinitions["usersCreate"]
			if updating {
				definition = contracts.RequestDefinitions["usersUpdate"]
			}
			if definition.Body != nil && definition.Body.Validate(body) != nil {
				return errors.New("用户名、昵称、邮箱、密码或状态不符合规则")
			}
			if err = kernel.ValidateUser(in, !updating); err != nil {
				return err
			}
			if !updating || in.Password != "" {
				if err = f.deps.ValidatePassword(ctx, in.Password); err != nil {
					return err
				}
			}
			if columns[4] != "" {
				dept, err := f.Store.Client.Department.Query().Where(department.CodeEQ(columns[4])).Only(ctx)
				if err != nil {
					return errors.New("部门编码不存在")
				}
				in.DepartmentID = &dept.ID
				if err = f.deps.ValidateGrantScope(ctx, p, "custom", []int{dept.ID}); err != nil {
					return err
				}
			}
			for _, code := range codeList(columns[5]) {
				pos, err := f.Store.Client.Position.Query().Where(position.CodeEQ(code)).Only(ctx)
				if err != nil {
					return fmt.Errorf("岗位编码不存在: %s", code)
				}
				in.PositionIDs = append(in.PositionIDs, pos.ID)
			}
			for _, code := range codeList(columns[6]) {
				assigned, err := f.Store.Client.Role.Query().Where(role.CodeEQ(code)).Only(ctx)
				if err != nil {
					return fmt.Errorf("角色编码不存在: %s", code)
				}
				in.RoleIDs = append(in.RoleIDs, assigned.ID)
			}
			if len(in.RoleIDs) > 0 && !canAssign {
				return errors.New("指定角色需要用户授权权限")
			}
			if err = f.deps.ValidateUserRelationsContext(ctx, p, in); err != nil {
				return err
			}
			if in.Email != nil {
				if seenEmails[strings.ToLower(*in.Email)] {
					return errors.New("文件内邮箱重复")
				}
				seenEmails[strings.ToLower(*in.Email)] = true
				query := f.Store.Client.User.Query().Where(user.EmailEQ(*in.Email))
				if updating {
					query = query.Where(user.IDNEQ(current.ID))
				}
				exists, err := query.Exist(ctx)
				if err != nil {
					return errors.New("邮箱查询失败")
				}
				if exists {
					return errors.New("邮箱已存在")
				}
			}
			if dryRun {
				item.Status = "success"
				item.Message = "预检通过，未写入"
				return nil
			}
			var hash []byte
			if in.Password != "" {
				hash, err = bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
				if err != nil {
					return errors.New("密码处理失败")
				}
			}
			err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
				var saved *ent.User
				if updating {
					update := tx.User.UpdateOneID(current.ID)
					kernel.ApplyUserUpdate(update, in)
					if hash != nil {
						update.SetPasswordHash(string(hash)).SetPasswordUpdatedAt(time.Now())
					}
					saved, err = update.Save(ctx)
				} else {
					create := tx.User.Create()
					kernel.ApplyUserCreate(create, in, p, hash)
					saved, err = create.Save(ctx)
				}
				if err != nil {
					return err
				}
				if updating {
					if _, err = tx.UserPosition.Delete().Where(userposition.UserIDEQ(saved.ID)).Exec(ctx); err != nil {
						return err
					}
					if _, err = tx.UserRole.Delete().Where(userrole.UserIDEQ(saved.ID)).Exec(ctx); err != nil {
						return err
					}
					if _, err = tx.Session.Update().Where(session.UserIDEQ(saved.ID), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(ctx); err != nil {
						return err
					}
				}
				for _, id := range in.PositionIDs {
					if err = tx.UserPosition.Create().SetUserID(saved.ID).SetPositionID(id).Exec(ctx); err != nil {
						return err
					}
				}
				for _, id := range in.RoleIDs {
					if err = tx.UserRole.Create().SetUserID(saved.ID).SetRoleID(id).Exec(ctx); err != nil {
						return err
					}
				}
				if err = f.deps.SyncDynamicGroupsInTx(ctx, tx, p); err != nil {
					return err
				}
				return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(trace).SetOperation("import").SetResource("users").SetResourceID(saved.ID).Exec(ctx)
			})
			if err != nil {
				return errors.New("写入失败，当前行已回滚")
			}
			item.Status = "success"
			if updating {
				item.Message = "已更新"
			} else {
				item.Message = "已创建"
			}
			return nil
		}()
		if err != nil {
			item.Message = err.Error()
		}
		switch item.Status {
		case "success":
			result.Success++
		case "skipped":
			result.Skipped++
		default:
			result.Failed++
		}
		result.Rows = append(result.Rows, item)
	}
	return result
}

func (f *Service) ProtectedUserContext(ctx context.Context, id int) (bool, error) {
	ids, err := f.deps.EffectiveRoleIDs(ctx, id)
	if err != nil {
		return false, err
	}
	return f.Store.Client.Role.Query().Where(role.IDIn(ids...), role.CodeEQ("super_admin")).Exist(ctx)
}
