package zenith

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/menu"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"golang.org/x/crypto/bcrypt"
)

// Seed installs the fixed first-release authorization catalogue.
func (s *Store) Seed(ctx context.Context) error {
	return s.WithTx(ctx, func(tx *ent.Tx) error {
		exists, err := tx.Role.Query().Where(role.CodeEQ("super_admin")).Exist(ctx)
		if err != nil {
			return err
		}
		if !exists {
			if err := tx.Role.Create().SetName("系统超级管理员").SetCode("super_admin").SetStatus("enabled").SetDataScope("all").Exec(ctx); err != nil {
				return err
			}
		}
		menuIDs := map[int]int{}
		legacyNames := map[string]bool{"home": true, "profile": true, "positions": true, "departments": true, "users": true, "roles": true, "menus": true, "user_groups": true, "dicts": true, "file_configs": true, "files": true, "file_settings": true, "login_logs": true, "operation_logs": true}
		for _, item := range foundationMenus {
			parentID := menuIDs[item.ParentID]
			if item.ParentID != 0 && parentID == 0 {
				return fmt.Errorf("menu parent %d missing", item.ParentID)
			}
			alternatives := []predicate.Menu{}
			if item.Name != "" {
				alternatives = append(alternatives, menu.NameEQ(item.Name))
			}
			if item.Type == "button" {
				alternatives = append(alternatives, menu.And(menu.TypeEQ("button"), menu.PermissionEQ(item.Permission), menu.ParentIDEQ(parentID)))
			}
			if item.Path != "" {
				alternatives = append(alternatives, menu.PathEQ(item.Path))
			}
			if item.Path == "/system/file-configs" {
				alternatives = append(alternatives, menu.NameEQ("file_configs"))
			}
			if item.Path == "/system/settings" {
				alternatives = append(alternatives, menu.NameEQ("file_settings"))
			}
			row, err := tx.Menu.Query().Where(menu.Or(alternatives...)).Order(ent.Asc(menu.FieldID)).First(ctx)
			if ent.IsNotFound(err) && item.Type == "button" && item.Permission != "" {
				// Upgrade legacy root buttons only if their intended parent has no
				// seed entry. A later custom button must not break repeat seeding.
				row, err = tx.Menu.Query().Where(menu.TypeEQ("button"), menu.PermissionEQ(item.Permission), menu.ParentIDEQ(0)).Order(ent.Asc(menu.FieldID)).First(ctx)
			}
			if err != nil && !ent.IsNotFound(err) {
				return err
			}
			if ent.IsNotFound(err) {
				create := tx.Menu.Create().SetTitle(item.Title).SetType(item.Type).SetSort(item.Sort).SetVisible(item.Visible).SetParentID(parentID)
				if item.Name != "" {
					create.SetName(item.Name)
				}
				if item.Path != "" {
					create.SetPath(item.Path)
				}
				if item.Component != "" {
					create.SetComponent(item.Component)
				}
				if item.Icon != "" {
					create.SetIcon(item.Icon)
				}
				if item.Permission != "" {
					create.SetPermission(item.Permission)
				}
				row, err = create.Save(ctx)
				if err != nil {
					return err
				}
			} else if row.Name == nil || legacyNames[*row.Name] || item.Type == "button" && row.ParentID == 0 {
				update := tx.Menu.UpdateOne(row).SetTitle(item.Title).SetType(item.Type).SetSort(item.Sort).SetVisible(item.Visible).SetParentID(parentID)
				if item.Name != "" {
					update.SetName(item.Name)
				} else {
					update.ClearName()
				}
				if item.Path != "" {
					update.SetPath(item.Path)
				}
				if item.Component != "" {
					update.SetComponent(item.Component)
				}
				if item.Icon != "" {
					update.SetIcon(item.Icon)
				}
				if item.Permission != "" {
					update.SetPermission(item.Permission)
				}
				row, err = update.Save(ctx)
				if err != nil {
					return err
				}
			}
			menuIDs[item.ID] = row.ID
		}
		return seedFoundationDictionaries(ctx, tx)
	})
}

func (s *Store) InitAdmin(ctx context.Context, username, password string) error {
	username = strings.TrimSpace(username)
	if len(username) < 3 || len(username) > 32 {
		return errors.New("username must contain 3-32 characters")
	}
	if err := s.validatePassword(ctx, password); err != nil {
		return err
	}
	if err := s.Seed(ctx); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.WithTx(ctx, func(tx *ent.Tx) error {
		exists, err := tx.User.Query().Where(user.UsernameEQ(username)).Exist(ctx)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("user %q already exists", username)
		}
		r, err := tx.Role.Query().Where(role.CodeEQ("super_admin")).Only(ctx)
		if err != nil {
			return err
		}
		u, err := tx.User.Create().SetUsername(username).SetNickname(username).SetPasswordHash(string(hash)).SetStatus("enabled").Save(ctx)
		if err != nil {
			return err
		}
		return tx.UserRole.Create().SetUserID(u.ID).SetRoleID(r.ID).Exec(ctx)
	})
}
