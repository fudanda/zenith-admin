package zenith

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/department"
	"github.com/fudanda/zenith-admin/backend/ent/position"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/session"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/ent/userposition"
	"github.com/fudanda/zenith-admin/backend/ent/userrole"
	"github.com/fudanda/zenith-admin/backend/internal/contracts"
	"github.com/xuri/excelize/v2"
	"golang.org/x/crypto/bcrypt"
)

var userImportHeaders = []string{"用户名", "昵称", "邮箱", "密码", "部门编码", "岗位编码(逗号)", "角色编码(逗号)", "状态"}

type importRow struct {
	Row     int    `json:"row"`
	Label   string `json:"label"`
	Status  string `json:"status"`
	Message string `json:"message"`
}
type importResult struct {
	DryRun  bool        `json:"dryRun"`
	Total   int         `json:"total"`
	Success int         `json:"success"`
	Failed  int         `json:"failed"`
	Skipped int         `json:"skipped"`
	Rows    []importRow `json:"rows"`
}

func (f *Framework) userImportTemplate(w http.ResponseWriter, r *http.Request) {
	book := excelize.NewFile()
	defer book.Close()
	headers := make([]any, len(userImportHeaders))
	for i, name := range userImportHeaders {
		headers[i] = name
	}
	if err := book.SetSheetRow("Sheet1", "A1", &headers); err != nil {
		fail(w, 500, "template_failed", "模板生成失败")
		return
	}
	book.SetColWidth("Sheet1", "A", "H", 24)
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", "attachment; filename=users-template.xlsx")
	w.Header().Set("Cache-Control", "private, no-store")
	book.Write(w)
}
func (f *Framework) syncUserImport(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		fail(w, 400, "invalid_upload", "请上传不超过 10 MB 的 XLSX 文件")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	dry := r.FormValue("dryRun")
	duplicate := r.FormValue("duplicate")
	if dry != "true" && dry != "false" || duplicate != "error" && duplicate != "skip" && duplicate != "update" {
		fail(w, 400, "invalid_request", "预检或重复处理选项无效")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, "invalid_upload", "需要导入文件")
		return
	}
	defer file.Close()
	if !strings.EqualFold(header.Filename[len(header.Filename)-min(5, len(header.Filename)):], ".xlsx") {
		fail(w, 400, "invalid_upload", "仅支持 XLSX 文件")
		return
	}
	book, err := excelize.OpenReader(file, excelize.Options{UnzipSizeLimit: 50 << 20})
	if err != nil {
		fail(w, 400, "invalid_workbook", "XLSX 文件无法读取")
		return
	}
	defer book.Close()
	sheets := book.GetSheetList()
	if len(sheets) == 0 {
		fail(w, 400, "invalid_workbook", "工作表为空")
		return
	}
	iterator, err := book.Rows(sheets[0])
	if err != nil {
		fail(w, 400, "invalid_workbook", "工作表无法读取")
		return
	}
	defer iterator.Close()
	if !iterator.Next() {
		fail(w, 400, "invalid_header", "缺少模板表头")
		return
	}
	headers, err := iterator.Columns()
	if err != nil || len(headers) != len(userImportHeaders) {
		fail(w, 400, "invalid_header", "表头必须与用户导入模板一致")
		return
	}
	for i, name := range userImportHeaders {
		if headers[i] != name {
			fail(w, 400, "invalid_header", "表头必须与用户导入模板一致")
			return
		}
	}
	data := [][]string{}
	for iterator.Next() {
		row, readErr := iterator.Columns()
		if readErr != nil {
			fail(w, 400, "invalid_workbook", "工作表行无法读取")
			return
		}
		data = append(data, row)
		if len(data) > 5000 {
			fail(w, 400, "too_many_rows", "同步导入最多 5000 行")
			return
		}
	}
	if iterator.Error() != nil {
		fail(w, 400, "invalid_workbook", "工作表读取失败")
		return
	}
	permissions, err := f.permissions(r.Context(), fromContext(r.Context()))
	if err != nil {
		fail(w, 503, "database_unavailable", "授权查询失败")
		return
	}
	result := f.importUsers(r.Context(), fromContext(r.Context()), permissions, requestID(r), data, dry == "true", duplicate)
	respond(w, 200, result)
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
func (f *Framework) importUsers(ctx context.Context, p *principal, permissions []string, trace string, data [][]string, dryRun bool, duplicate string) importResult {
	result := importResult{DryRun: dryRun, Rows: []importRow{}}
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
		item := importRow{Row: index + 2, Status: "failed"}
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
			in := userInput{Username: columns[0], Nickname: columns[1], Password: columns[3], Status: columns[7], PositionIDs: []int{}, RoleIDs: []int{}}
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
				if _, err = f.visibleUser(ctx, p, current.ID); err != nil {
					return errors.New("账号不在可修改范围")
				}
				if !canAssign {
					return errors.New("更新现有用户授权需要用户授权权限")
				}
				in.Phone = current.Phone
				in.Gender = current.Gender
				in.BirthDate = current.BirthDate
				in.Avatar = current.Avatar
				root, err := f.protectedUserContext(ctx, current.ID)
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
			if err = validateUser(in, !updating); err != nil {
				return err
			}
			if !updating || in.Password != "" {
				if err = f.validatePassword(ctx, in.Password); err != nil {
					return err
				}
			}
			if columns[4] != "" {
				dept, err := f.Store.Client.Department.Query().Where(department.CodeEQ(columns[4])).Only(ctx)
				if err != nil {
					return errors.New("部门编码不存在")
				}
				in.DepartmentID = &dept.ID
				if err = f.validateGrantScope(ctx, p, "custom", []int{dept.ID}); err != nil {
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
			if err = f.validateUserRelationsContext(ctx, p, in); err != nil {
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
					applyUserUpdate(update, in)
					if hash != nil {
						update.SetPasswordHash(string(hash)).SetPasswordUpdatedAt(time.Now())
					}
					saved, err = update.Save(ctx)
				} else {
					create := tx.User.Create()
					applyUserCreate(create, in, p, hash)
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
				if err = f.syncDynamicGroupsInTx(ctx, tx, p); err != nil {
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

func (f *Framework) protectedUserContext(ctx context.Context, id int) (bool, error) {
	ids, err := f.effectiveRoleIDs(ctx, id)
	if err != nil {
		return false, err
	}
	return f.Store.Client.Role.Query().Where(role.IDIn(ids...), role.CodeEQ("super_admin")).Exist(ctx)
}
