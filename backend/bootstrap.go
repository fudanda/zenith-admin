package zenith

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/menu"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"golang.org/x/crypto/bcrypt"
)

// Seed installs the fixed first-release authorization catalogue.
func (s *Store) Seed(ctx context.Context) error {
	return s.WithTx(ctx, func(tx *ent.Tx) error {
		exists, err := tx.Role.Query().Where(role.CodeEQ("super_admin"), role.TenantIDIsNil()).Exist(ctx)
		if err != nil {
			return err
		}
		if !exists {
			if err := tx.Role.Create().SetName("平台超级管理员").SetCode("super_admin").SetStatus("enabled").SetDataScope("all").Exec(ctx); err != nil {
				return err
			}
		}
		for _, item := range foundationMenus {
			exists, err := tx.Menu.Query().Where(menu.NameEQ(item.Name)).Exist(ctx)
			if err != nil {
				return err
			}
			if exists {
				continue
			}
			create := tx.Menu.Create().SetName(item.Name).SetTitle(item.Title).SetType(item.Type).SetSort(item.Sort)
			if item.Path != "" {
				create.SetPath(item.Path)
			}
			if item.Permission != "" {
				create.SetPermission(item.Permission)
			}
			if err := create.Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) InitAdmin(ctx context.Context, username, password string) error {
	username = strings.TrimSpace(username)
	if len(username) < 3 || len(username) > 32 {
		return errors.New("username must contain 3-32 characters")
	}
	if len(password) < 12 {
		return errors.New("password must contain at least 12 characters")
	}
	if err := s.Seed(ctx); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.WithTx(ctx, func(tx *ent.Tx) error {
		exists, err := tx.User.Query().Where(user.UsernameEQ(username), user.TenantIDIsNil()).Exist(ctx)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("platform user %q already exists", username)
		}
		r, err := tx.Role.Query().Where(role.CodeEQ("super_admin"), role.TenantIDIsNil()).Only(ctx)
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
