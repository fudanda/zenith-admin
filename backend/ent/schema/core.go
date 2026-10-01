package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"
)

// Fixed single-organization system entities.
type Department struct{ ent.Schema }

func (Department) Fields() []ent.Field {
	return []ent.Field{
		field.Int("parent_id").Default(0),
		field.String("name").MaxLen(64), field.String("code").MaxLen(64), field.String("category").Default("department"),
		field.Int("leader_id").Optional().Nillable(), field.String("phone").Optional().Nillable(), field.String("email").Optional().Nillable(),
		field.Int("sort").Default(0), field.String("status").Default("enabled"),
		field.Time("created_at").Default(time.Now), field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (Department) Indexes() []ent.Index {
	return []ent.Index{index.Fields("code").Unique()}
}

type UserPosition struct{ ent.Schema }

func (UserPosition) Fields() []ent.Field {
	return []ent.Field{field.Int("user_id"), field.Int("position_id"), field.Time("created_at").Default(time.Now)}
}
func (UserPosition) Indexes() []ent.Index {
	return []ent.Index{index.Fields("user_id", "position_id").Unique()}
}

type User struct{ ent.Schema }

func (User) Fields() []ent.Field {
	return []ent.Field{
		field.String("username").MaxLen(32), field.String("nickname").MaxLen(32),
		field.String("password_hash").Sensitive(), field.String("status").Default("enabled"),
		field.String("avatar").Optional().Nillable(),
		field.String("email").Optional().Nillable(), field.String("phone").Optional().Nillable(),
		field.String("gender").Optional().Nillable(), field.String("birth_date").Optional().Nillable(),
		field.Int("department_id").Optional().Nillable(),
		field.JSON("preferences", map[string]any{}).Optional(),
		field.JSON("favorite_menus", []int{}).Optional(), field.String("user_data_scope").Optional().Nillable(),
		field.Time("password_updated_at").Default(time.Now),
		field.Time("created_at").Default(time.Now), field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (User) Indexes() []ent.Index { return []ent.Index{index.Fields("username").Unique()} }

type Session struct{ ent.Schema }

func (Session) Fields() []ent.Field {
	return []ent.Field{
		field.Int("user_id"), field.String("token_hash").Unique().Sensitive(),
		field.String("csrf_hash").Sensitive(),
		field.Time("expires_at"), field.Time("revoked_at").Optional().Nillable(),
		field.String("ip").Default(""), field.String("client").Default("web"),
		field.String("browser").Default(""), field.String("os").Default(""),
		field.Time("last_active_at").Default(time.Now),
		field.Time("created_at").Default(time.Now),
	}
}
func (Session) Indexes() []ent.Index {
	return []ent.Index{index.Fields("user_id"), index.Fields("expires_at")}
}

type Position struct{ ent.Schema }

func (Position) Fields() []ent.Field {
	return []ent.Field{
		field.String("name").MaxLen(64), field.String("code").MaxLen(64),
		field.Int("sort").Default(0), field.String("status").Default("enabled"),
		field.String("remark").Optional().Nillable(), field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (Position) Indexes() []ent.Index { return []ent.Index{index.Fields("code").Unique()} }

type AuditLog struct{ ent.Schema }

func (AuditLog) Fields() []ent.Field {
	return []ent.Field{
		field.Int("actor_id"), field.String("operation").MaxLen(100), field.String("resource").MaxLen(100),
		field.Int("resource_id").Optional().Nillable(), field.String("request_id").Optional(),
		field.String("module").Default(""), field.String("description").Default(""), field.String("method").Default(""), field.String("path").Default(""),
		field.String("ip").Default(""), field.String("user_agent").Default(""), field.String("browser").Default(""), field.String("os").Default(""),
		field.String("request_body").Optional().Nillable(), field.Int("duration_ms").Default(0), field.Int("response_code").Default(200),
		field.Time("created_at").Default(time.Now),
	}
}
func (AuditLog) Indexes() []ent.Index { return []ent.Index{index.Fields("created_at")} }

type LoginLog struct{ ent.Schema }

func (LoginLog) Fields() []ent.Field {
	return []ent.Field{
		field.Int("user_id").Optional().Nillable(), field.String("username"),
		field.String("ip").Optional(),
		field.String("event_type").Default("login"), field.String("user_agent").Default(""), field.String("browser").Default(""), field.String("os").Default(""),
		field.Bool("success"), field.String("reason").Optional(), field.Time("created_at").Default(time.Now),
	}
}
func (LoginLog) Indexes() []ent.Index { return []ent.Index{index.Fields("created_at")} }

type LoginAttempt struct{ ent.Schema }

func (LoginAttempt) Fields() []ent.Field {
	return []ent.Field{
		field.String("key").Unique().Sensitive(), field.String("username_hash").Default("").Sensitive(), field.Int("failures").Default(0),
		field.Time("locked_until").Optional().Nillable(), field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

type Captcha struct{ ent.Schema }

func (Captcha) Fields() []ent.Field {
	return []ent.Field{field.String("public_id").Unique(), field.String("answer_hash").Sensitive(),
		field.Time("expires_at"), field.Time("used_at").Optional().Nillable(),
		field.Time("created_at").Default(time.Now)}
}

type Role struct{ ent.Schema }

func (Role) Fields() []ent.Field {
	return []ent.Field{
		field.String("name"),
		field.String("code"), field.String("description").Optional().Nillable(), field.String("status").Default("enabled"),
		field.String("data_scope").Default("all"),
		field.Time("created_at").Default(time.Now), field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (Role) Indexes() []ent.Index { return []ent.Index{index.Fields("code").Unique()} }

type Menu struct{ ent.Schema }

func (Menu) Fields() []ent.Field {
	return []ent.Field{
		field.Int("parent_id").Default(0), field.String("title").MaxLen(64), field.String("name").Optional().Nillable(),
		field.String("path").Optional().Nillable(), field.String("component").Optional().Nillable(), field.String("icon").Optional().Nillable(),
		field.String("type").Default("menu"), field.String("permission").Optional().Nillable(),
		field.String("query").Optional().Nillable(), field.Bool("is_external").Default(false),
		field.Bool("embed").Default(false), field.Bool("keep_alive").Default(false), field.Int("sort").Default(0),
		field.String("status").Default("enabled"), field.Bool("visible").Default(true), field.String("feature_key").Optional().Nillable(),
		field.Time("created_at").Default(time.Now), field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (Menu) Indexes() []ent.Index { return []ent.Index{index.Fields("name").Unique()} }

type RoleMenu struct{ ent.Schema }

func (RoleMenu) Fields() []ent.Field { return []ent.Field{field.Int("role_id"), field.Int("menu_id")} }
func (RoleMenu) Indexes() []ent.Index {
	return []ent.Index{index.Fields("role_id", "menu_id").Unique()}
}

type UserMenu struct{ ent.Schema }

func (UserMenu) Fields() []ent.Field { return []ent.Field{field.Int("user_id"), field.Int("menu_id")} }
func (UserMenu) Indexes() []ent.Index {
	return []ent.Index{index.Fields("user_id", "menu_id").Unique()}
}

type UserRole struct{ ent.Schema }

func (UserRole) Fields() []ent.Field { return []ent.Field{field.Int("user_id"), field.Int("role_id")} }
func (UserRole) Indexes() []ent.Index {
	return []ent.Index{index.Fields("user_id", "role_id").Unique()}
}

type RolePermission struct{ ent.Schema }

func (RolePermission) Fields() []ent.Field {
	return []ent.Field{field.Int("role_id"), field.String("permission")}
}
func (RolePermission) Indexes() []ent.Index {
	return []ent.Index{index.Fields("role_id", "permission").Unique()}
}

type RoleDepartment struct{ ent.Schema }

func (RoleDepartment) Fields() []ent.Field {
	return []ent.Field{field.Int("role_id"), field.Int("department_id")}
}
func (RoleDepartment) Indexes() []ent.Index {
	return []ent.Index{index.Fields("role_id", "department_id").Unique()}
}

type UserDepartmentScope struct{ ent.Schema }

func (UserDepartmentScope) Fields() []ent.Field {
	return []ent.Field{field.Int("user_id"), field.Int("department_id")}
}
func (UserDepartmentScope) Indexes() []ent.Index {
	return []ent.Index{index.Fields("user_id", "department_id").Unique()}
}

type UserPermission struct{ ent.Schema }

func (UserPermission) Fields() []ent.Field {
	return []ent.Field{field.Int("user_id"), field.String("permission")}
}
func (UserPermission) Indexes() []ent.Index {
	return []ent.Index{index.Fields("user_id", "permission").Unique()}
}

type UserGroup struct{ ent.Schema }

func (UserGroup) Fields() []ent.Field {
	return []ent.Field{field.String("name"), field.String("code"),
		field.String("description").Optional().Nillable(), field.Int("owner_id").Optional().Nillable(), field.String("member_mode").Default("static"),
		field.JSON("member_rule", map[string]any{}).Optional(), field.Time("rule_synced_at").Optional().Nillable(),
		field.String("status").Default("enabled"), field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now)}
}
func (UserGroup) Indexes() []ent.Index {
	return []ent.Index{index.Fields("code").Unique()}
}

type UserGroupMember struct{ ent.Schema }

func (UserGroupMember) Fields() []ent.Field {
	return []ent.Field{field.Int("group_id"), field.Int("user_id"), field.Time("created_at").Default(time.Now)}
}
func (UserGroupMember) Indexes() []ent.Index {
	return []ent.Index{index.Fields("group_id", "user_id").Unique()}
}

type UserGroupRole struct{ ent.Schema }

func (UserGroupRole) Fields() []ent.Field {
	return []ent.Field{field.Int("group_id"), field.Int("role_id")}
}
func (UserGroupRole) Indexes() []ent.Index {
	return []ent.Index{index.Fields("group_id", "role_id").Unique()}
}

type Dict struct{ ent.Schema }

func (Dict) Fields() []ent.Field {
	return []ent.Field{
		field.String("name").MaxLen(64), field.String("code").MaxLen(64),
		field.String("description").Optional().Nillable(), field.String("status").Default("enabled"),
		field.Time("created_at").Default(time.Now), field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (Dict) Indexes() []ent.Index { return []ent.Index{index.Fields("code").Unique()} }

type DictItem struct{ ent.Schema }

func (DictItem) Fields() []ent.Field {
	return []ent.Field{
		field.Int("dict_id"), field.Int("parent_id").Optional().Nillable(), field.String("label").MaxLen(64), field.String("value").MaxLen(64),
		field.String("color").Optional().Nillable(), field.Int("sort").Default(0), field.String("status").Default("enabled"),
		field.String("remark").Optional().Nillable(), field.JSON("metadata", map[string]any{}).Optional(),
		field.Int("created_by").Optional().Nillable(), field.Int("updated_by").Optional().Nillable(),
		field.Time("created_at").Default(time.Now), field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (DictItem) Indexes() []ent.Index { return []ent.Index{index.Fields("dict_id", "value").Unique()} }

type FileStorageConfig struct{ ent.Schema }

func (FileStorageConfig) Fields() []ent.Field {
	return []ent.Field{
		field.String("name").MaxLen(64), field.String("provider").Default("local"), field.String("status").Default("enabled"),
		field.Bool("is_default").Default(false), field.String("local_root_path").MaxLen(512), field.String("remark").Optional().Nillable(),
		field.Time("created_at").Default(time.Now), field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

type ManagedFile struct{ ent.Schema }

func (ManagedFile) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New), field.Int("storage_config_id"), field.Int("uploader_id"), field.String("original_name").MaxLen(256), field.String("object_key").MaxLen(512),
		field.Int64("size"), field.String("mime_type").Optional().Nillable(), field.String("extension").Optional().Nillable(),
		field.String("visibility").Default("public"), field.String("content_hash").Optional().Nillable(),
		field.Bool("delete_pending").Default(false),
		field.Time("created_at").Default(time.Now), field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (ManagedFile) Indexes() []ent.Index {
	return []ent.Index{index.Fields("created_at"), index.Fields("storage_config_id")}
}

type UploadSession struct{ ent.Schema }

func (UploadSession) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").MaxLen(64), field.Int("storage_config_id"), field.Int("uploader_id"),
		field.String("file_name").MaxLen(256), field.Int64("file_size"), field.String("mime_type").Optional().Nillable(),
		field.Int64("chunk_size"), field.Int("total_chunks"), field.String("visibility").Default("public"), field.String("status").Default("uploading"),
		field.Time("expires_at"), field.Time("created_at").Default(time.Now), field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (UploadSession) Indexes() []ent.Index {
	return []ent.Index{index.Fields("expires_at"), index.Fields("uploader_id")}
}

type UploadChunk struct{ ent.Schema }

func (UploadChunk) Fields() []ent.Field {
	return []ent.Field{
		field.String("upload_id").MaxLen(64), field.Int("chunk_index"), field.Int64("size"), field.String("hash"),
	}
}
func (UploadChunk) Indexes() []ent.Index {
	return []ent.Index{index.Fields("upload_id", "chunk_index").Unique()}
}

// SystemSetting stores versioned platform overrides for enabled foundation modules.
type SystemSetting struct{ ent.Schema }

func (SystemSetting) Fields() []ent.Field {
	return []ent.Field{
		field.String("module").MaxLen(64).Unique(),
		field.Int("version").Positive(),
		field.JSON("data", map[string]any{}),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
