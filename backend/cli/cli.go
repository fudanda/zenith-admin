// Package cli exposes operational commands to independent Go hosts.
package cli

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	arcbase "github.com/fudanda/arcbase/backend"
	"github.com/fudanda/arcbase/backend/internal/operations"
	"github.com/fudanda/arcbase/backend/internal/storage"
	"golang.org/x/term"
)

type Options struct {
	Args                []string
	Input               io.Reader
	Output, ErrorOutput io.Writer
	Config              arcbase.Config
}
type Migrator interface {
	Migrate(context.Context, *arcbase.Store) error
}
type Seeder interface {
	Seed(context.Context, *arcbase.Store) error
}
type Checker interface {
	Check(context.Context, *arcbase.Store) error
}

func ConfigFromEnvironment() (arcbase.Config, error) {
	secure := true
	if raw := Environment("ARCBASE_INSECURE_COOKIES"); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return arcbase.Config{}, errors.New("ARCBASE_INSECURE_COOKIES must be true or false")
		}
		secure = !value
	}
	return arcbase.Config{DSN: Environment("ARCBASE_DATABASE_URL"), Address: Environment("ARCBASE_ADDR"), SecureCookies: secure, StorageEncryptionKey: Environment("ARCBASE_STORAGE_KEY"), FileStagingPath: Environment("ARCBASE_FILE_STAGING_PATH")}, nil
}
func printJSON(output io.Writer, value any) error { return json.NewEncoder(output).Encode(value) }

func Run(ctx context.Context, options Options) error {
	if options.Input == nil {
		options.Input = os.Stdin
	}
	if options.Output == nil {
		options.Output = os.Stdout
	}
	if options.ErrorOutput == nil {
		options.ErrorOutput = os.Stderr
	}
	if len(options.Args) == 0 {
		return errors.New("usage: arcbase {serve|version|check|migrate|seed|init-admin|reset-admin|backup|verify-backup|restore|backup-sqlite}")
	}
	command, args := options.Args[0], options.Args[1:]
	if command == "version" {
		if len(args) > 0 {
			return errors.New("version accepts no arguments")
		}
		return printJSON(options.Output, map[string]any{"version": arcbase.Version, "commit": arcbase.Commit, "buildTime": arcbase.BuildTime, "schemaVersion": arcbase.SchemaVersion})
	}
	if command == "verify-backup" {
		if len(args) != 1 {
			return errors.New("usage: verify-backup DIRECTORY")
		}
		value, err := operations.Verify(args[0])
		if err != nil {
			return err
		}
		return printJSON(options.Output, value)
	}
	if command == "serve" {
		if len(args) > 0 {
			return errors.New("serve accepts no arguments")
		}
		app, err := arcbase.New(ctx, options.Config)
		if err != nil {
			return err
		}
		defer app.Shutdown(context.Background())
		return app.Run(ctx)
	}
	if command == "backup" || command == "restore" {
		if len(args) == 0 || strings.HasPrefix(args[0], "-") {
			return errors.New("backup/restore requires DIRECTORY followed by options")
		}
		flags := flag.NewFlagSet(command, flag.ContinueOnError)
		flags.SetOutput(options.ErrorOutput)
		pg := flags.String("pg-container", "", "optional PostgreSQL Docker container with pg_dump/pg_restore")
		files := flags.String("files-root", "", "new restored file directory")
		env := flags.String("env-file", "", "new restored environment file")
		s3 := flags.Bool("s3-to-local", false, "explicitly restore S3 object snapshots into new local storage")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if flags.NArg() > 0 {
			return errors.New("unexpected arguments")
		}
		settings := operations.Options{DSN: options.Config.DSN, Directory: args[0], PostgresContainer: *pg, FilesRoot: *files, EnvironmentFile: *env, S3ToLocal: *s3, StagingPath: options.Config.FileStagingPath, StorageKey: options.Config.StorageEncryptionKey}
		var value operations.Manifest
		var err error
		if command == "backup" {
			value, err = operations.Backup(ctx, settings)
		} else {
			value, err = operations.Restore(ctx, settings)
		}
		if err != nil {
			return err
		}
		return printJSON(options.Output, value)
	}
	if command != "check" && command != "migrate" && command != "seed" && command != "init-admin" && command != "reset-admin" && command != "backup-sqlite" {
		return fmt.Errorf("unknown command %q", command)
	}
	if command == "check" {
		if len(args) > 0 {
			return errors.New("check accepts no arguments")
		}
		address := options.Config.Address
		if address == "" {
			address = "127.0.0.1:8080"
		}
		if _, _, err := net.SplitHostPort(address); err != nil {
			return errors.New("ARCBASE_ADDR must be HOST:PORT")
		}
		if _, err := storage.SecretKey(options.Config.StorageEncryptionKey); err != nil {
			return err
		}
		if options.Config.FileStagingPath != "" {
			if err := checkWritableDirectory(options.Config.FileStagingPath); err != nil {
				return err
			}
		}
	}
	store, err := arcbase.OpenStore(ctx, options.Config.DSN)
	if err != nil {
		return errors.New("database unavailable; check ARCBASE_DATABASE_URL and database service")
	}
	defer store.Close()
	if command == "seed" || command == "init-admin" || command == "reset-admin" {
		if err = store.AcquireLease(ctx, false); err != nil {
			return err
		}
	}
	switch command {
	case "check":
		var version int
		if err := store.DB.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0) FROM zenith_schema_versions").Scan(&version); err != nil {
			return errors.New("database is not initialized; run migrate")
		}
		if version != arcbase.SchemaVersion {
			return fmt.Errorf("database migration required: found %d, expected %d", version, arcbase.SchemaVersion)
		}
		configs, err := store.Client.FileStorageConfig.Query().All(ctx)
		if err != nil {
			return errors.New("file configuration query failed")
		}
		for _, row := range configs {
			if row.Provider == "local" {
				if err := checkWritableDirectory(row.LocalRootPath); err != nil {
					return err
				}
			} else if row.Provider == "s3" {
				key, err := storage.SecretKey(options.Config.StorageEncryptionKey)
				if err != nil {
					return err
				}
				if _, err = storage.Decrypt(key, row.S3SecretCipher); err != nil {
					return errors.New("S3 credentials cannot be decrypted with configured key")
				}
			}
		}
		for _, module := range options.Config.Modules {
			if checker, ok := module.(Checker); ok {
				if err = checker.Check(ctx, store); err != nil {
					return fmt.Errorf("module %s check: %w", module.Name(), err)
				}
			}
		}
		return printJSON(options.Output, map[string]any{"ok": true, "dialect": store.Dialect, "schemaVersion": version, "secureCookies": options.Config.SecureCookies, "storageConfigurations": len(configs)})
	case "migrate":
		if len(args) > 0 {
			return errors.New("migrate accepts no arguments")
		}
		if err = store.AcquireLease(ctx, true); err != nil {
			return err
		}
		if err = store.Migrate(ctx); err != nil {
			return err
		}
		for _, module := range options.Config.Modules {
			if migrator, ok := module.(Migrator); ok {
				if err = migrator.Migrate(ctx, store); err != nil {
					return fmt.Errorf("module %s migration: %w", module.Name(), err)
				}
			}
		}
	case "seed":
		if len(args) > 0 {
			return errors.New("seed accepts no arguments")
		}
		if err = store.Seed(ctx); err != nil {
			return err
		}
		for _, module := range options.Config.Modules {
			if seeder, ok := module.(Seeder); ok {
				if err = seeder.Seed(ctx, store); err != nil {
					return fmt.Errorf("module %s seed: %w", module.Name(), err)
				}
			}
		}
	case "init-admin", "reset-admin":
		if len(args) == 0 || strings.HasPrefix(args[0], "-") {
			return errors.New("administrator command requires USERNAME followed by options")
		}
		flags := flag.NewFlagSet(command, flag.ContinueOnError)
		flags.SetOutput(options.ErrorOutput)
		generate := flags.Bool("generate", false, "generate a random password")
		file := flags.String("credentials-file", "", "save local credentials; startup never applies this file")
		if err = flags.Parse(args[1:]); err != nil {
			return err
		}
		if flags.NArg() > 0 {
			return errors.New("unexpected arguments")
		}
		if *generate && *file == "" {
			return errors.New("--generate requires --credentials-file; secrets are never printed")
		}
		var password string
		if *generate {
			var bytes [24]byte
			if _, err = rand.Read(bytes[:]); err != nil {
				return err
			}
			password = "Aa1!" + hex.EncodeToString(bytes[:])
		} else {
			if input, ok := options.Input.(*os.File); ok && term.IsTerminal(int(input.Fd())) {
				fmt.Fprint(options.ErrorOutput, "Administrator password: ")
				raw, readErr := term.ReadPassword(int(input.Fd()))
				fmt.Fprintln(options.ErrorOutput)
				if readErr != nil {
					return readErr
				}
				password = string(raw)
			} else {
				raw, readErr := bufio.NewReader(options.Input).ReadString('\n')
				if readErr != nil && !(readErr == io.EOF && raw != "") {
					return errors.New("read password from stdin failed")
				}
				password = strings.TrimRight(raw, "\r\n")
			}
		}
		var revert func() error
		if *file != "" {
			revert, err = writeCredentials(*file, args[0], password)
			if err != nil {
				return err
			}
		}
		if command == "init-admin" {
			err = store.InitAdmin(ctx, args[0], password)
		} else {
			err = store.ResetAdmin(ctx, args[0], password)
		}
		if err != nil {
			if revert != nil {
				err = errors.Join(err, revert())
			}
			return err
		}
		return printJSON(options.Output, map[string]any{"ok": true, "command": command, "username": args[0], "credentialsFile": *file})
	case "backup-sqlite":
		if len(args) != 1 {
			return errors.New("usage: backup-sqlite OUTPUT.db")
		}
		if err = store.BackupSQLite(ctx, args[0]); err != nil {
			return err
		}
	}
	return printJSON(options.Output, map[string]any{"ok": true, "command": command})
}

func checkWritableDirectory(path string) error {
	if path == "" {
		return errors.New("file directory is not configured")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("file directory is missing or not a real directory")
	}
	file, err := os.CreateTemp(path, ".arcbase-check-")
	if err != nil {
		return errors.New("file directory is not writable")
	}
	name := file.Name()
	return errors.Join(file.Close(), os.Remove(name))
}
func writeCredentials(path, username, password string) (func() error, error) {
	if strings.ContainsAny(username, "\r\n") {
		return nil, errors.New("invalid username")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	parent := filepath.Dir(absolute)
	for {
		if _, err = os.Lstat(parent); err == nil {
			break
		}
		if !os.IsNotExist(err) {
			return nil, err
		}
		parent = filepath.Dir(parent)
	}
	real, err := filepath.EvalSymlinks(parent)
	if err != nil || !strings.EqualFold(real, parent) {
		return nil, errors.New("credentials parent must not traverse a symbolic link")
	}
	original, err := os.ReadFile(absolute)
	existed := err == nil
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if info, err := os.Lstat(absolute); err == nil && !info.Mode().IsRegular() {
		return nil, errors.New("credentials path must be a regular file")
	}
	lines := strings.Split(string(original), "\n")
	result := []string{}
	for _, line := range lines {
		trim := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "export "))
		key, _, found := strings.Cut(trim, "=")
		if found && (strings.TrimSpace(key) == "ARCBASE_ADMIN_USERNAME" || strings.TrimSpace(key) == "ARCBASE_ADMIN_PASSWORD" || strings.TrimSpace(key) == "ZENITH_ADMIN_USERNAME" || strings.TrimSpace(key) == "ZENITH_ADMIN_PASSWORD") {
			continue
		}
		result = append(result, line)
	}
	result = append(result, "ARCBASE_ADMIN_USERNAME="+strconv.Quote(username), "ARCBASE_ADMIN_PASSWORD="+strconv.Quote(password))
	if err = os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		return nil, err
	}
	if err = replacePrivateFile(absolute, []byte(strings.TrimRight(strings.Join(result, "\n"), "\r\n")+"\n")); err != nil {
		return nil, err
	}
	return func() error {
		if existed {
			return replacePrivateFile(absolute, original)
		}
		return os.Remove(absolute)
	}, nil
}

func replacePrivateFile(path string, content []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".arcbase-credentials-")
	if err != nil {
		return err
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(content)
	}
	if err == nil {
		err = file.Sync()
	}
	err = errors.Join(err, file.Close())
	if err != nil {
		return err
	}
	return os.Rename(temporary, path)
}
