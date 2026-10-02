// Package operations implements offline, portable database/file recovery.
package operations

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"entgo.io/ent/dialect"
	"github.com/fudanda/arcbase/backend/ent/managedfile"
	"github.com/fudanda/arcbase/backend/internal/data"
	"github.com/fudanda/arcbase/backend/internal/storage"
	s3bytes "github.com/fudanda/arcbase/backend/internal/storage/s3"
	"github.com/gofrs/flock"
)

type Options struct {
	DSN, Directory, StagingPath, StorageKey, PostgresContainer, FilesRoot, EnvironmentFile string
	S3ToLocal                                                                              bool
}
type Entry struct {
	Path, SHA256 string
	Size         int64
}
type Root struct {
	ID             int
	Provider, Path string
}
type Manifest struct {
	Format               int
	Dialect              string
	SchemaVersion        int
	CreatedAt            time.Time
	Roots                []Root
	Staging, KeyIncluded bool
	Files                []Entry
}

func child(root, name string) (string, error) {
	if name == "" || strings.Contains(name, "\\") || strings.Contains(name, ":") || filepath.IsAbs(name) {
		return "", errors.New("invalid backup entry")
	}
	path := filepath.Join(root, filepath.FromSlash(name))
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("backup path escapes directory")
	}
	return path, nil
}
func nested(parent, path string) bool {
	rel, err := filepath.Rel(parent, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}
func realParent(path string) error {
	parent := filepath.Dir(path)
	for {
		if _, err := os.Lstat(parent); err == nil {
			break
		} else if !os.IsNotExist(err) {
			return err
		}
		next := filepath.Dir(parent)
		if next == parent {
			return errors.New("invalid target parent")
		}
		parent = next
	}
	real, err := filepath.EvalSymlinks(parent)
	if err != nil || !strings.EqualFold(filepath.Clean(real), filepath.Clean(parent)) {
		return errors.New("target parent must not traverse a symbolic link")
	}
	return nil
}
func copyFile(source, target string) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("backup only accepts regular files; symbolic links are rejected")
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	return copyReader(input, target)
}
func copyReader(input io.Reader, target string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return err
	}
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	syncErr := output.Sync()
	return errors.Join(copyErr, syncErr, output.Close())
}
func copyTree(source, target string) error {
	info, err := os.Lstat(source)
	if os.IsNotExist(err) {
		return os.MkdirAll(target, 0700)
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("storage root must be a real directory")
	}
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("storage contains a symbolic link")
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		dest := filepath.Join(target, rel)
		if entry.IsDir() {
			return os.MkdirAll(dest, 0700)
		}
		return copyFile(path, dest)
	})
}
func digestFile(path string) (Entry, error) {
	file, err := os.Open(path)
	if err != nil {
		return Entry{}, err
	}
	defer file.Close()
	hash := sha256.New()
	n, err := io.Copy(hash, file)
	return Entry{SHA256: hex.EncodeToString(hash.Sum(nil)), Size: n}, err
}
func inventory(directory string) ([]Entry, error) {
	entries := []Entry{}
	err := filepath.WalkDir(directory, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if path == filepath.Join(directory, "manifest.json") {
			return nil
		}
		value, err := digestFile(path)
		if err != nil {
			return err
		}
		value.Path, err = filepath.Rel(directory, path)
		value.Path = filepath.ToSlash(value.Path)
		entries = append(entries, value)
		return err
	})
	return entries, err
}

// PG passwords are sent via environment, or a private stdin prefix for docker;
// neither the connection URL nor password is put into command arguments/logs.
func pgCommand(ctx context.Context, options Options, tool string, args []string, archive io.Reader, output io.Writer) error {
	u, err := url.Parse(options.DSN)
	if err != nil || u.User == nil || u.Hostname() == "" || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		return errors.New("PostgreSQL CLI tools require a postgres:// connection URL")
	}
	password, _ := u.User.Password()
	if u.Query().Get("search_path") != "" {
		return errors.New("database backup requires a database URL without a custom search_path")
	}
	if strings.ContainsAny(password, "\r\n") {
		return errors.New("PostgreSQL CLI password cannot contain newlines")
	}
	port := u.Port()
	if port == "" {
		port = "5432"
	}
	host := u.Hostname()
	if options.PostgresContainer != "" {
		host, port = "127.0.0.1", "5432"
	}
	args = append([]string{"--no-password", "--host", host, "--port", port, "--username", u.User.Username(), "--dbname", strings.TrimPrefix(u.Path, "/")}, args...)
	var cmd *exec.Cmd
	if options.PostgresContainer != "" {
		if strings.HasPrefix(options.PostgresContainer, "-") || strings.ContainsAny(options.PostgresContainer, "\r\n") {
			return errors.New("invalid PostgreSQL container name")
		}
		command := append([]string{"exec", "-i", options.PostgresContainer, "sh", "-c", `IFS= read -r PGPASSWORD; export PGPASSWORD; exec "$@"`, "arcbase-pg-tool", tool}, args...)
		cmd = exec.CommandContext(ctx, "docker", command...)
		if archive == nil {
			archive = strings.NewReader("")
		}
		cmd.Stdin = io.MultiReader(strings.NewReader(password+"\n"), archive)
	} else {
		cmd = exec.CommandContext(ctx, tool, args...)
		cmd.Env = append(os.Environ(), "PGPASSWORD="+password)
		if mode := u.Query().Get("sslmode"); mode != "" {
			cmd.Env = append(cmd.Env, "PGSSLMODE="+mode)
		}
		for query, variable := range map[string]string{"sslcert": "PGSSLCERT", "sslkey": "PGSSLKEY", "sslrootcert": "PGSSLROOTCERT"} {
			if value := u.Query().Get(query); value != "" {
				cmd.Env = append(cmd.Env, variable+"="+value)
			}
		}
		cmd.Stdin = archive
	}
	cmd.Stdout = output
	// PostgreSQL error messages can echo private connection information.
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s failed; check tool availability, database privileges and server version", tool)
	}
	return nil
}

func Backup(ctx context.Context, options Options) (Manifest, error) {
	if options.StagingPath == "" {
		options.StagingPath = filepath.Join("data", "uploads")
	}
	manifest := Manifest{Format: 1, SchemaVersion: data.SchemaVersion, CreatedAt: time.Now().UTC(), Roots: []Root{}}
	target, err := filepath.Abs(options.Directory)
	if err != nil || options.Directory == "" {
		return manifest, errors.New("backup requires a new output directory")
	}
	if _, err = os.Lstat(target); !os.IsNotExist(err) {
		return manifest, errors.New("backup output already exists")
	}
	if err = realParent(target); err != nil {
		return manifest, err
	}
	store, err := data.OpenStore(ctx, options.DSN)
	if err != nil {
		return manifest, errors.New("backup database unavailable")
	}
	defer store.Close()
	if err = store.AcquireLease(ctx, true); err != nil {
		return manifest, err
	}
	var version int
	if err = store.DB.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0) FROM zenith_schema_versions").Scan(&version); err != nil || version != data.SchemaVersion {
		return manifest, errors.New("database migration version does not match this binary")
	}
	manifest.Dialect = store.Dialect
	configs, err := store.Client.FileStorageConfig.Query().All(ctx)
	if err != nil {
		return manifest, err
	}
	for _, row := range configs {
		if row.Provider == "local" {
			root, err := filepath.Abs(row.LocalRootPath)
			if err != nil || row.LocalRootPath == "" {
				return manifest, errors.New("invalid local storage root")
			}
			if nested(root, target) {
				return manifest, errors.New("backup output must be outside file roots")
			}
		}
	}
	if options.StagingPath != "" {
		root, err := filepath.Abs(options.StagingPath)
		if err != nil || nested(root, target) {
			return manifest, errors.New("backup output must be outside staging")
		}
	}
	if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return manifest, err
	}
	stage, err := os.MkdirTemp(filepath.Dir(target), ".arcbase-backup-")
	if err != nil {
		return manifest, err
	}
	defer os.RemoveAll(stage)
	dbName := "database.dump"
	if store.Dialect == dialect.SQLite {
		dbName = "database.db"
		err = store.BackupSQLite(ctx, filepath.Join(stage, dbName))
	} else {
		file, openErr := os.OpenFile(filepath.Join(stage, dbName), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if openErr != nil {
			return manifest, openErr
		}
		err = errors.Join(pgCommand(ctx, options, "pg_dump", []string{"--format=custom"}, nil, file), file.Close())
	}
	if err != nil {
		return manifest, err
	}
	key, err := storage.SecretKey(options.StorageKey)
	if err != nil {
		return manifest, err
	}
	for _, row := range configs {
		name := "storage-" + strconv.Itoa(row.ID)
		path := filepath.Join(stage, "files", name)
		manifest.Roots = append(manifest.Roots, Root{ID: row.ID, Provider: row.Provider, Path: "files/" + name})
		if row.Provider == "local" {
			managed, queryErr := store.Client.ManagedFile.Query().Where(managedfile.StorageConfigIDEQ(row.ID)).All(ctx)
			if queryErr != nil {
				return manifest, queryErr
			}
			for _, file := range managed {
				object, pathErr := child(row.LocalRootPath, file.ObjectKey)
				if pathErr != nil {
					return manifest, pathErr
				}
				actual, readErr := digestFile(object)
				if readErr != nil || actual.Size != file.Size || file.ContentHash != nil && actual.SHA256 != *file.ContentHash {
					return manifest, errors.New("managed local file is missing or damaged")
				}
			}
			if err = copyTree(row.LocalRootPath, path); err != nil {
				return manifest, err
			}
			continue
		}
		if row.Provider != "s3" {
			return manifest, errors.New("unsupported file provider")
		}
		// S3 local cache contains resumable chunk parts and canceled-upload state.
		if err = copyTree(row.LocalRootPath, path); err != nil {
			return manifest, err
		}
		secret, err := storage.Decrypt(key, row.S3SecretCipher)
		if err != nil {
			return manifest, err
		}
		client, err := s3bytes.New(s3bytes.Config{Region: row.S3Region, Endpoint: row.S3Endpoint, Bucket: row.S3Bucket, AccessKeyID: row.S3AccessKeyID, Secret: secret, ForcePathStyle: row.S3ForcePathStyle})
		if err != nil {
			return manifest, errors.New("invalid S3 configuration")
		}
		files, err := store.Client.ManagedFile.Query().Where(managedfile.StorageConfigIDEQ(row.ID)).All(ctx)
		if err != nil {
			return manifest, err
		}
		if err = os.MkdirAll(path, 0700); err != nil {
			return manifest, err
		}
		for _, file := range files {
			dest, err := child(path, file.ObjectKey)
			if err != nil {
				return manifest, err
			}
			object, err := client.Open(ctx, file.ObjectKey)
			if err != nil {
				return manifest, errors.New("S3 object snapshot failed")
			}
			copyErr := copyReader(object, dest)
			closeErr := object.Close()
			if err = errors.Join(copyErr, closeErr); err != nil {
				return manifest, err
			}
			actual, readErr := digestFile(dest)
			if readErr != nil || actual.Size != file.Size || file.ContentHash != nil && actual.SHA256 != *file.ContentHash {
				return manifest, errors.New("S3 snapshot content does not match metadata")
			}
		}
	}
	if options.StagingPath != "" {
		if err = copyTree(options.StagingPath, filepath.Join(stage, "staging")); err != nil {
			return manifest, err
		}
		manifest.Staging = true
	}
	if options.StorageKey != "" {
		if err = os.WriteFile(filepath.Join(stage, "secrets.env"), []byte("ARCBASE_STORAGE_KEY="+options.StorageKey+"\n"), 0600); err != nil {
			return manifest, err
		}
		manifest.KeyIncluded = true
	}
	manifest.Files, err = inventory(stage)
	if err != nil {
		return manifest, err
	}
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return manifest, err
	}
	if err = os.WriteFile(filepath.Join(stage, "manifest.json"), append(raw, '\n'), 0600); err != nil {
		return manifest, err
	}
	if err = os.Rename(stage, target); err != nil {
		return manifest, err
	}
	return manifest, nil
}

func Verify(directory string) (Manifest, error) {
	var manifest Manifest
	directory, err := filepath.Abs(directory)
	if err != nil {
		return manifest, err
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return manifest, errors.New("backup must be a real directory")
	}
	raw, err := os.ReadFile(filepath.Join(directory, "manifest.json"))
	if err != nil {
		return manifest, err
	}
	if err = json.Unmarshal(raw, &manifest); err != nil || manifest.Format != 1 || manifest.SchemaVersion != data.SchemaVersion || (manifest.Dialect != dialect.SQLite && manifest.Dialect != dialect.Postgres) {
		return manifest, errors.New("unsupported backup manifest")
	}
	seen := map[string]bool{}
	for _, entry := range manifest.Files {
		path, err := child(directory, entry.Path)
		if err != nil || seen[entry.Path] {
			return manifest, errors.New("invalid or duplicate backup entry")
		}
		seen[entry.Path] = true
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			return manifest, errors.New("backup entry is missing or not a regular file")
		}
		actual, err := digestFile(path)
		if err != nil || actual.Size != entry.Size || actual.SHA256 != entry.SHA256 {
			return manifest, fmt.Errorf("backup checksum failed: %s", entry.Path)
		}
	}
	actual, err := inventory(directory)
	if err != nil || len(actual) != len(manifest.Files) {
		return manifest, errors.New("backup inventory does not match manifest")
	}
	name := "database.dump"
	if manifest.Dialect == dialect.SQLite {
		name = "database.db"
	}
	if !seen[name] || manifest.KeyIncluded && !seen["secrets.env"] {
		return manifest, errors.New("backup is incomplete")
	}
	for _, root := range manifest.Roots {
		if root.ID <= 0 || root.Path != "files/storage-"+strconv.Itoa(root.ID) || (root.Provider != "local" && root.Provider != "s3") {
			return manifest, errors.New("invalid storage manifest")
		}
		rootPath, _ := child(directory, root.Path)
		if info, err := os.Lstat(rootPath); err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return manifest, errors.New("backup storage directory is missing")
		}
	}
	return manifest, nil
}

// Restore never overwrites a database/file directory. S3 snapshots can be
// explicitly restored to local storage; no existing remote objects are changed.
func Restore(ctx context.Context, options Options) (Manifest, error) {
	manifest, err := Verify(options.Directory)
	if err != nil {
		return manifest, err
	}
	for _, root := range manifest.Roots {
		if root.Provider == "s3" && !options.S3ToLocal {
			return manifest, errors.New("S3 snapshot restore requires --s3-to-local; existing buckets are never overwritten")
		}
	}
	hasS3 := false
	for _, root := range manifest.Roots {
		if root.Provider == "s3" {
			hasS3 = true
		}
	}
	if options.FilesRoot == "" || options.EnvironmentFile == "" {
		return manifest, errors.New("restore requires new --files-root and --env-file paths")
	}
	files, err := filepath.Abs(options.FilesRoot)
	if err != nil {
		return manifest, err
	}
	source, err := filepath.Abs(options.Directory)
	if err != nil || nested(source, files) || nested(files, source) {
		return manifest, errors.New("restore target must be separate from backup")
	}
	if _, err = os.Lstat(files); !os.IsNotExist(err) {
		return manifest, errors.New("restore file directory already exists")
	}
	if _, err = os.Lstat(options.EnvironmentFile); !os.IsNotExist(err) {
		return manifest, errors.New("restore environment file already exists")
	}
	environment, err := filepath.Abs(options.EnvironmentFile)
	if err != nil || nested(source, environment) || nested(files, environment) || nested(environment, files) {
		return manifest, errors.New("restore environment must be separate from backup and file directory")
	}
	for _, target := range []string{files, environment} {
		if err = realParent(target); err != nil {
			return manifest, err
		}
	}
	key := ""
	if manifest.KeyIncluded {
		raw, readErr := os.ReadFile(filepath.Join(source, "secrets.env"))
		if readErr != nil {
			return manifest, readErr
		}
		key = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(string(raw), "ARCBASE_STORAGE_KEY="), "ZENITH_STORAGE_KEY="))
		if _, err = storage.SecretKey(key); err != nil {
			return manifest, err
		}
	}
	var store *data.Store
	var database string
	var sqliteLock *flock.Flock
	if manifest.Dialect == dialect.SQLite {
		if !strings.HasPrefix(options.DSN, "sqlite:") {
			return manifest, errors.New("backup and target database dialect must match")
		}
		database, err = filepath.Abs(strings.TrimPrefix(options.DSN, "sqlite:"))
		if err != nil {
			return manifest, err
		}
		if nested(source, database) || nested(files, database) || nested(database, files) || database == environment {
			return manifest, errors.New("restore database must be separate from backup, files and environment")
		}
		if err = realParent(database); err != nil {
			return manifest, err
		}
		if _, err = os.Lstat(database); !os.IsNotExist(err) {
			return manifest, errors.New("restore SQLite target must be a new database file")
		}
		if err = os.MkdirAll(filepath.Dir(database), 0700); err != nil {
			return manifest, err
		}
		sqliteLock = flock.New(database + ".maintenance.lock")
		locked, err := sqliteLock.TryLock()
		if err != nil || !locked {
			sqliteLock.Close()
			return manifest, errors.New("restore target is in use")
		}
		defer sqliteLock.Close()
	} else {
		if strings.HasPrefix(options.DSN, "sqlite:") {
			return manifest, errors.New("backup and target database dialect must match")
		}
		store, err = data.OpenStore(ctx, options.DSN)
		if err != nil {
			return manifest, errors.New("restore database unavailable")
		}
		defer store.Close()
		if err = store.AcquireLease(ctx, true); err != nil {
			return manifest, err
		}
		var count int
		if err = store.DB.QueryRowContext(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`).Scan(&count); err != nil || count != 0 {
			return manifest, errors.New("restore PostgreSQL target must be an empty database")
		}
	}
	if err = os.Mkdir(files, 0700); err != nil {
		return manifest, err
	}
	databaseRestored := false
	defer func() {
		if !databaseRestored {
			_ = os.RemoveAll(files)
			_ = os.Remove(environment)
		}
	}()
	for _, root := range manifest.Roots {
		path, _ := child(source, root.Path)
		if err = copyTree(path, filepath.Join(files, "storage-"+strconv.Itoa(root.ID))); err != nil {
			return manifest, err
		}
	}
	staging := filepath.Join(files, "staging")
	if manifest.Staging {
		if err = copyTree(filepath.Join(source, "staging"), staging); err != nil {
			return manifest, err
		}
	} else if err = os.MkdirAll(staging, 0700); err != nil {
		return manifest, err
	}
	if hasS3 {
		// A local clone must not execute compensation jobs against the source bucket.
		pending := filepath.Join(staging, ".pending-objects")
		if _, err = os.Lstat(pending); err == nil {
			if err = os.Rename(pending, filepath.Join(staging, ".source-s3-journal")); err != nil {
				return manifest, err
			}
		} else if !os.IsNotExist(err) {
			return manifest, err
		}
	}
	env := fmt.Sprintf("ARCBASE_DATABASE_URL=%s\nARCBASE_FILE_STAGING_PATH=%s\nARCBASE_STORAGE_KEY=%s\n", strconv.Quote(options.DSN), strconv.Quote(staging), key)
	if err = copyReader(strings.NewReader(env), environment); err != nil {
		return manifest, err
	}
	if manifest.Dialect == dialect.SQLite {
		if err = copyFile(filepath.Join(source, "database.db"), database); err != nil {
			return manifest, err
		}
		store, err = data.OpenStore(ctx, "sqlite:"+database)
		if err != nil {
			_ = os.Remove(database)
			return manifest, err
		}
		defer store.Close()
	} else {
		archive, err := os.Open(filepath.Join(source, "database.dump"))
		if err != nil {
			return manifest, err
		}
		err = pgCommand(ctx, options, "pg_restore", []string{"--no-owner", "--no-privileges", "--single-transaction", "--exit-on-error"}, archive, io.Discard)
		archive.Close()
		if err != nil {
			return manifest, err
		}
	}
	// Once the database is committed, retain bytes and configuration on later
	// failure so recovery never leaves restored metadata pointing at deleted files.
	databaseRestored = true
	tx, err := store.Client.Tx(ctx)
	if err != nil {
		return manifest, errors.New("database restored; storage relocation failed; retain recovery directory")
	}
	defer tx.Rollback()
	for _, root := range manifest.Roots {
		update := tx.FileStorageConfig.UpdateOneID(root.ID).SetLocalRootPath(filepath.Join(files, "storage-"+strconv.Itoa(root.ID)))
		if root.Provider == "s3" {
			update.SetProvider("local").SetBasePath("")
		}
		if err = update.Exec(ctx); err != nil {
			return manifest, errors.New("database restored; storage relocation failed; retain recovery directory")
		}
	}
	if err = tx.Commit(); err != nil {
		return manifest, errors.New("database restored; storage relocation failed; retain recovery directory")
	}
	return manifest, nil
}
