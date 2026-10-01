// sqlite-baseline writes an OFFLINE Ent snapshot for review. Never run it over
// a released migration; future schema changes require a new migration version.
package main

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"entgo.io/ent/dialect/sql/schema"
	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/migrate"
	_ "modernc.org/sqlite"
)

func main() {
	db, err := sql.Open("sqlite", "file::memory:?_pragma=foreign_keys(1)")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	client := ent.NewClient(ent.Driver(entsql.OpenDB(dialect.SQLite, db)))
	tables := map[string]*schema.Table{}
	for _, table := range migrate.Tables {
		tables[table.Name] = table
	}
	column := func(table *schema.Table, name string) *schema.Column {
		for _, col := range table.Columns {
			if col.Name == name {
				return col
			}
		}
		log.Fatalf("missing column %s.%s", table.Name, name)
		return nil
	}
	// Match the reviewed PostgreSQL foreign-key policies without tenant fields.
	for _, fk := range [][4]string{
		{"users", "department_id", "departments", "SET NULL"},
		{"departments", "leader_id", "users", "SET NULL"},
		{"user_positions", "user_id", "users", "CASCADE"}, {"user_positions", "position_id", "positions", "CASCADE"},
		{"sessions", "user_id", "users", "CASCADE"},
		{"user_roles", "user_id", "users", "CASCADE"}, {"user_roles", "role_id", "roles", "CASCADE"},
		{"role_permissions", "role_id", "roles", "CASCADE"},
		{"role_menus", "role_id", "roles", "CASCADE"}, {"role_menus", "menu_id", "menus", "CASCADE"},
		{"user_menus", "user_id", "users", "CASCADE"}, {"user_menus", "menu_id", "menus", "CASCADE"},
		{"role_departments", "role_id", "roles", "CASCADE"}, {"role_departments", "department_id", "departments", "CASCADE"},
		{"user_permissions", "user_id", "users", "CASCADE"},
		{"user_department_scopes", "user_id", "users", "CASCADE"}, {"user_department_scopes", "department_id", "departments", "CASCADE"},
		{"user_groups", "owner_id", "users", "SET NULL"},
		{"user_group_members", "group_id", "user_groups", "CASCADE"}, {"user_group_members", "user_id", "users", "CASCADE"},
		{"user_group_roles", "group_id", "user_groups", "CASCADE"}, {"user_group_roles", "role_id", "roles", "CASCADE"},
		{"dict_items", "dict_id", "dicts", "CASCADE"}, {"dict_items", "parent_id", "dict_items", "SET NULL"},
		{"managed_files", "storage_config_id", "file_storage_configs", "RESTRICT"}, {"managed_files", "uploader_id", "users", "RESTRICT"},
		{"upload_sessions", "storage_config_id", "file_storage_configs", "RESTRICT"}, {"upload_sessions", "uploader_id", "users", "RESTRICT"},
		{"upload_chunks", "upload_id", "upload_sessions", "CASCADE"},
	} {
		table, target := tables[fk[0]], tables[fk[2]]
		table.AddForeignKey(&schema.ForeignKey{Symbol: fk[0] + "_" + fk[1] + "_fk", Columns: []*schema.Column{column(table, fk[1])}, RefTable: target, RefColumns: []*schema.Column{column(target, "id")}, OnDelete: schema.ReferenceOption(fk[3])})
	}
	var snapshot bytes.Buffer
	if err := client.Schema.WriteTo(context.Background(), &snapshot); err != nil {
		log.Fatal(err)
	}
	fmt.Fprintln(os.Stdout, "-- Ent SQLite single-organization v10 snapshot with reviewed foreign keys.")
	for _, line := range strings.Split(snapshot.String(), "\n") {
		// Migrate executes in one immediate transaction with FK checks enabled.
		// Atlas' outer pragma toggles have no effect inside a SQLite transaction.
		if !strings.HasPrefix(line, "PRAGMA foreign_keys") {
			fmt.Fprintln(os.Stdout, line)
		}
	}
	fmt.Fprintln(os.Stdout, "CREATE UNIQUE INDEX file_storage_configs_default_unique ON file_storage_configs(is_default) WHERE is_default = 1;")
}
