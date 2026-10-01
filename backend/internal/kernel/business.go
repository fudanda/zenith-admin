package kernel

import (
	"encoding/json"
	"errors"
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/department"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/internal/contracts"
	"github.com/fudanda/zenith-admin/backend/internal/security"
)

var ErrUnauthenticated = errors.New("authentication required")

type Principal = security.Principal

var FromContext = security.FromContext

func PublicUser(u *ent.User) map[string]any {
	return map[string]any{"id": u.ID, "username": u.Username, "nickname": u.Nickname, "status": u.Status, "email": u.Email, "preferences": u.Preferences}
}

func DepartmentScope(_ *Principal) predicate.Department { return department.IDGT(0) }

func StorageConfigView(row *ent.FileStorageConfig) map[string]any {
	return map[string]any{
		"id": row.ID, "name": row.Name, "provider": row.Provider, "status": row.Status, "isDefault": row.IsDefault, "basePath": row.BasePath, "objectAcl": "default",
		"urlStrategy": "proxy", "publicBaseUrl": nil, "presignedExpirySeconds": contracts.StorageDefaults.PresignedExpirySeconds, "localRootPath": func() any {
			if row.Provider == "s3" {
				return nil
			}
			return row.LocalRootPath
		}(), "s3Region": row.S3Region, "s3Endpoint": row.S3Endpoint, "s3Bucket": row.S3Bucket, "s3AccessKeyId": row.S3AccessKeyID, "s3ForcePathStyle": row.S3ForcePathStyle, "remark": row.Remark,
		"createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt,
	}
}

var ErrGrantDenied = errors.New("不能授予超出本人权限或数据范围的授权")

var ErrInvalidGroupRule = errors.New("动态用户组规则无效")

type MemberRule struct {
	DepartmentIDs         []int `json:"departmentIds,omitempty"`
	IncludeSubDepartments bool  `json:"includeSubDepartments,omitempty"`
	PositionIDs           []int `json:"positionIds,omitempty"`
	IncludeUserIDs        []int `json:"includeUserIds,omitempty"`
	ExcludeUserIDs        []int `json:"excludeUserIds,omitempty"`
}

func MenuView(row *ent.Menu) map[string]any {
	view := map[string]any{"id": row.ID, "parentId": row.ParentID, "title": row.Title, "type": row.Type, "sort": row.Sort,
		"status": row.Status, "visible": row.Visible, "featureKey": row.FeatureKey, "query": row.Query,
		"isExternal": row.IsExternal, "embed": row.Embed, "keepAlive": row.KeepAlive,
		"createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}
	for _, field := range []struct {
		key   string
		value *string
	}{{"name", row.Name}, {"path", row.Path},
		{"permission", row.Permission}, {"component", row.Component}, {"icon", row.Icon}} {
		if field.value != nil {
			view[field.key] = *field.value
		}
	}
	return view
}

func MenuTree(rows []*ent.Menu) []any {
	byID := make(map[int]map[string]any, len(rows))
	for _, row := range rows {
		byID[row.ID] = MenuView(row)
	}
	roots := make([]any, 0)
	for _, row := range rows {
		node := byID[row.ID]
		if parent := byID[row.ParentID]; parent != nil {
			children, _ := parent["children"].([]any)
			parent["children"] = append(children, node)
		} else {
			roots = append(roots, node)
		}
	}
	return roots
}

var RoleCodePattern = regexp.MustCompile(`^[a-z_]+$`)

var DataScopes = map[string]bool{"all": true, "custom": true, "dept_only": true, "dept": true, "self": true}

func RoleScope(_ *Principal) predicate.Role { return role.IDGT(0) }

type RoleInput struct {
	Name         string  `json:"name"`
	Code         string  `json:"code"`
	Description  *string `json:"description"`
	Status       string  `json:"status"`
	DataScope    string  `json:"dataScope"`
	DeptScopeIDs []int   `json:"deptScopeIds"`
}

type SecurityPolicy struct {
	Password struct {
		MinLength          int  `json:"minLength"`
		RequireUppercase   bool `json:"requireUppercase"`
		RequireSpecialChar bool `json:"requireSpecialChar"`
		ExpiryEnabled      bool `json:"expiryEnabled"`
		ExpiryDays         int  `json:"expiryDays"`
	} `json:"password"`
	LoginChallenge struct {
		MaxAttemptsPerSource int `json:"maxAttemptsPerSource"`
		SourceLimit          int `json:"sourceLimit"`
		WindowMinutes        int `json:"windowMinutes"`
	} `json:"loginChallenge"`
	Session struct {
		MaxSessions  int    `json:"maxSessions"`
		Scope        string `json:"scope"`
		ExceedAction string `json:"exceedAction"`
	} `json:"session"`
}

func UsernameHash(name string) string { return Digest(strings.ToLower(name)) }

func SessionView(row *ent.Session, p *Principal) map[string]any {
	return map[string]any{"tokenId": strconv.Itoa(row.ID), "client": row.Client, "ip": row.IP, "location": nil, "browser": row.Browser, "os": row.Os, "loginAt": row.CreatedAt, "lastActiveAt": row.LastActiveAt, "isCurrent": p != nil && p.Session != nil && row.ID == p.Session.ID}
}

const Mib int64 = 1 << 20

type FileSettings struct {
	UploadValidateType bool     `json:"uploadValidateType"`
	UploadAllowedTypes []string `json:"uploadAllowedTypes"`
	UploadMaxSizeMb    int      `json:"uploadMaxSizeMb"`
	ChunkThresholdMb   int      `json:"chunkThresholdMb"`
	ChunkSizeMb        int      `json:"chunkSizeMb"`
}

func DefaultFileSettings() FileSettings {
	raw, err := json.Marshal(contracts.Settings["files"].Defaults)
	if err != nil {
		panic(err)
	}
	var settings FileSettings
	if err = json.Unmarshal(raw, &settings); err != nil {
		panic(err)
	}
	return settings
}

func MimeAllowed(mimeType string, allowed []string) bool {
	for _, rule := range allowed {
		if rule == "*" || rule == "*/*" || strings.EqualFold(rule, mimeType) || strings.HasSuffix(rule, "/*") && strings.HasPrefix(strings.ToLower(mimeType), strings.ToLower(strings.TrimSuffix(rule, "*"))) {
			return true
		}
	}
	return false
}

func ExpectedSignatureMime(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".pdf":
		return "application/pdf"
	default:
		return ""
	}
}

var ErrSettingsConflict = errors.New("settings version conflict")

var PhonePattern = regexp.MustCompile(`^1[3-9][0-9]{9}$`)

func UserScope(_ *Principal) predicate.User { return user.IDGT(0) }

var ErrUserFilter = errors.New("账号筛选条件无效")

type UserInput struct {
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

func ValidateUser(in UserInput, creating bool) error {
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
	if in.Phone != nil && *in.Phone != "" && !PhonePattern.MatchString(*in.Phone) {
		return errors.New("手机号无效")
	}
	return nil
}

func ApplyUserCreate(create *ent.UserCreate, in UserInput, p *Principal, hash []byte) {
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

func ApplyUserUpdate(update *ent.UserUpdateOne, in UserInput) {
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

func ValidBatchUserIDs(ids []int) bool {
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

var FoundationMenuJSON = contracts.MenuSeed

type FoundationMenu struct {
	ID, ParentID                                         int
	Name, Title, Type, Path, Permission, Component, Icon string
	Sort                                                 int
	Visible                                              bool
}

var FoundationMenus = func() []FoundationMenu {
	var result []FoundationMenu
	if err := json.Unmarshal(FoundationMenuJSON, &result); err != nil {
		panic(err)
	}
	return result
}()

func BrowserName(agent string) string {
	for _, name := range []string{"Edg/", "Firefox/", "Chrome/", "Safari/"} {
		if strings.Contains(agent, name) {
			return strings.TrimSuffix(name, "/")
		}
	}
	return ""
}

func OsName(agent string) string {
	for _, name := range []string{"Android", "iPhone", "iPad", "Windows", "Mac OS", "Linux"} {
		if strings.Contains(agent, name) {
			return name
		}
	}
	return ""
}
