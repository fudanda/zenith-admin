package files

import (
	"context"
	"encoding/json"
	"entgo.io/ent/dialect"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/filestorageconfig"
	"github.com/fudanda/zenith-admin/backend/ent/managedfile"
	"github.com/fudanda/zenith-admin/backend/ent/uploadsession"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
	"github.com/fudanda/zenith-admin/backend/internal/storage"
	objectstore "github.com/fudanda/zenith-admin/backend/internal/storage/s3"
)

func (f *Service) objects(row *ent.FileStorageConfig) (*objectstore.Client, error) {
	secret, err := storage.Decrypt(f.EncryptionKey, row.S3SecretCipher)
	if err != nil {
		return nil, err
	}
	return objectstore.New(objectstore.Config{Region: row.S3Region, Endpoint: row.S3Endpoint, Bucket: row.S3Bucket, AccessKeyID: row.S3AccessKeyID, Secret: secret, ForcePathStyle: row.S3ForcePathStyle})
}

type storageConfig struct {
	Name                   string  `json:"name"`
	Provider               string  `json:"provider"`
	Status                 string  `json:"status"`
	IsDefault              bool    `json:"isDefault"`
	LocalRootPath          string  `json:"localRootPath"`
	Remark                 *string `json:"remark"`
	Region                 string  `json:"s3Region"`
	Endpoint               string  `json:"s3Endpoint"`
	Bucket                 string  `json:"s3Bucket"`
	AccessKeyID            string  `json:"s3AccessKeyId"`
	Secret                 string  `json:"s3SecretAccessKey"`
	ForcePathStyle         bool    `json:"s3ForcePathStyle"`
	Prefix                 string  `json:"basePath"`
	ObjectAcl              string  `json:"objectAcl"`
	URLStrategy            string  `json:"urlStrategy"`
	PublicBaseURL          string  `json:"publicBaseUrl"`
	PresignedExpirySeconds int     `json:"presignedExpirySeconds"`
}

func configValues(row *ent.FileStorageConfig) storageConfig {
	return storageConfig{Name: row.Name, Provider: row.Provider, Status: row.Status, IsDefault: row.IsDefault, LocalRootPath: row.LocalRootPath, Remark: row.Remark, Region: row.S3Region, Endpoint: row.S3Endpoint, Bucket: row.S3Bucket, AccessKeyID: row.S3AccessKeyID, ForcePathStyle: row.S3ForcePathStyle, Prefix: row.BasePath}
}
func (f *Service) parseStorage(ctx context.Context, in kernel.Input) (storageConfig, *ent.FileStorageConfig, error) {
	values := storageConfig{Provider: "local", Status: "enabled"}
	var row *ent.FileStorageConfig
	if in.Update || in.Id != "" {
		id, err := kernel.IntParam(in.Id)
		if err != nil {
			return values, nil, kernel.Fail(400, "invalid_id", "ID 无效")
		}
		row, err = f.Store.Client.FileStorageConfig.Get(ctx, id)
		if err != nil {
			return values, nil, err
		}
		values = configValues(row)
	}
	var patch map[string]json.RawMessage
	if kernel.DecodeBody(in.Body, &patch) != nil || len(patch) == 0 && row == nil {
		return values, nil, kernel.Fail(400, "invalid_request", "配置无效")
	}
	// JSON's merge into existing struct keeps omitted fields. Empty secrets are
	// explicitly retained; all response projections omit encrypted credentials.
	if kernel.DecodeBody(in.Body, &values) != nil {
		return values, nil, kernel.Fail(400, "invalid_request", "配置字段无效")
	}
	if values.Secret == "" && row != nil && row.S3SecretCipher != "" {
		secret, err := storage.Decrypt(f.EncryptionKey, row.S3SecretCipher)
		if err != nil {
			return values, row, err
		}
		values.Secret = secret
	}
	return values, row, nil
}
func (f *Service) validateConfig(values *storageConfig) error {
	if values.URLStrategy != "" && values.URLStrategy != "proxy" || values.ObjectAcl != "" && values.ObjectAcl != "default" || values.PublicBaseURL != "" {
		return kernel.Fail(400, "unsupported_strategy", "仅支持由 Go 授权的代理访问和继承 Bucket ACL")
	}
	if values.Provider == "local" {
		if strings.TrimSpace(values.LocalRootPath) == "" {
			return kernel.Fail(400, "invalid_storage", "本地存储目录不能为空")
		}
		root, err := filepath.Abs(values.LocalRootPath)
		if err != nil {
			return err
		}
		values.LocalRootPath = root
		return validateStorageConfig(storageConfigInput{Name: values.Name, Provider: values.Provider, Status: values.Status, IsDefault: values.IsDefault, LocalRootPath: root, Remark: values.Remark})
	}
	if values.Provider != "s3" || strings.TrimSpace(values.Name) == "" || len([]rune(values.Name)) > 64 || values.Status != "enabled" && values.Status != "disabled" || values.IsDefault && values.Status != "enabled" {
		return kernel.Fail(400, "invalid_storage", "存储配置无效")
	}
	if err := objectstore.ValidatePrefix(values.Prefix); err != nil {
		return err
	}
	if values.Remark != nil && len([]rune(*values.Remark)) > 256 {
		return kernel.Fail(400, "invalid_storage", "备注最多 256 字")
	}
	return objectstore.Validate(objectstore.Config{Region: values.Region, Endpoint: values.Endpoint, Bucket: values.Bucket, AccessKeyID: values.AccessKeyID, Secret: values.Secret})
}
func (f *Service) SaveStorageConfig(ctx context.Context, in kernel.Input) (kernel.Outcome, error) {
	values, current, err := f.parseStorage(ctx, in)
	if err != nil {
		return kernel.Outcome{}, err
	}
	if err = f.validateConfig(&values); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_storage", err.Error())
	}
	cipher := ""
	if values.Provider == "s3" {
		cipher, err = storage.Encrypt(f.EncryptionKey, values.Secret)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "storage_key_missing", err.Error())
		}
		base := f.StagingPath
		if base == "" {
			base = filepath.Join("data", "uploads")
		}
		base, err = filepath.Abs(base)
		if err != nil {
			return kernel.Outcome{}, err
		}
		values.LocalRootPath = filepath.Join(base, kernel.Digest(values.Endpoint + ":" + values.Bucket)[:24])
	}
	if current != nil && (current.Provider != values.Provider || current.LocalRootPath != values.LocalRootPath || current.S3Bucket != values.Bucket || current.S3Endpoint != values.Endpoint || current.BasePath != values.Prefix) {
		has, err := f.Store.Client.ManagedFile.Query().Where(managedfile.StorageConfigIDEQ(current.ID)).Exist(ctx)
		if err != nil {
			return kernel.Outcome{}, err
		}
		active, err := f.Store.Client.UploadSession.Query().Where(uploadsession.StorageConfigIDEQ(current.ID), uploadsession.StatusEQ("uploading")).Exist(ctx)
		if err != nil {
			return kernel.Outcome{}, err
		}
		if has || active {
			return kernel.Outcome{}, kernel.Fail(409, "storage_in_use", "配置仍有文件或上传任务，不能更改存储位置")
		}
	}
	if err = os.MkdirAll(values.LocalRootPath, 0700); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "storage_path_unavailable", "存储目录不可用")
	}
	var saved *ent.FileStorageConfig
	p := kernel.FromContext(ctx)
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if current != nil {
			locked, err := f.lockConfig(ctx, tx, current.ID)
			if err != nil {
				return err
			}
			if locked.Provider != values.Provider || locked.LocalRootPath != values.LocalRootPath || locked.S3Bucket != values.Bucket || locked.S3Endpoint != values.Endpoint || locked.BasePath != values.Prefix {
				has, err := tx.ManagedFile.Query().Where(managedfile.StorageConfigIDEQ(current.ID)).Exist(ctx)
				if err != nil {
					return err
				}
				active, err := tx.UploadSession.Query().Where(uploadsession.StorageConfigIDEQ(current.ID), uploadsession.StatusEQ("uploading")).Exist(ctx)
				if err != nil {
					return err
				}
				if has || active {
					return kernel.Fail(409, "storage_in_use", "配置仍有文件或上传任务，不能更改存储位置")
				}
			}
		}
		if values.IsDefault {
			if err := tx.FileStorageConfig.Update().Where(filestorageconfig.IsDefault(true)).SetIsDefault(false).Exec(ctx); err != nil {
				return err
			}
		}
		if current == nil {
			saved, err = tx.FileStorageConfig.Create().SetName(values.Name).SetProvider(values.Provider).SetStatus(values.Status).SetIsDefault(values.IsDefault).SetLocalRootPath(values.LocalRootPath).SetNillableRemark(values.Remark).SetS3Region(values.Region).SetS3Endpoint(values.Endpoint).SetS3Bucket(values.Bucket).SetS3AccessKeyID(values.AccessKeyID).SetS3SecretCipher(cipher).SetS3ForcePathStyle(values.ForcePathStyle).SetBasePath(values.Prefix).Save(ctx)
		} else {
			saved, err = tx.FileStorageConfig.UpdateOneID(current.ID).SetName(values.Name).SetProvider(values.Provider).SetStatus(values.Status).SetIsDefault(values.IsDefault).SetLocalRootPath(values.LocalRootPath).SetNillableRemark(values.Remark).SetS3Region(values.Region).SetS3Endpoint(values.Endpoint).SetS3Bucket(values.Bucket).SetS3AccessKeyID(values.AccessKeyID).SetS3SecretCipher(cipher).SetS3ForcePathStyle(values.ForcePathStyle).SetBasePath(values.Prefix).Save(ctx)
		}
		if err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetOperation("save_storage").SetResource("file_storage_configs").SetResourceID(saved.ID).SetRequestID(in.TraceID).Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, err
	}
	return kernel.Success(200, kernel.StorageConfigView(saved))
}
func (f *Service) TestStorage(ctx context.Context, in kernel.Input) (kernel.Outcome, error) {
	values, _, err := f.parseStorage(ctx, in)
	if err != nil {
		return kernel.Outcome{}, err
	}
	if err = f.validateConfig(&values); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_storage", err.Error())
	}
	if values.Provider == "local" {
		if err = checkWritableDirectory(values.LocalRootPath); err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "storage_unavailable", "目录不可写")
		}
	} else {
		client, e := objectstore.New(objectstore.Config{Region: values.Region, Endpoint: values.Endpoint, Bucket: values.Bucket, AccessKeyID: values.AccessKeyID, Secret: values.Secret, ForcePathStyle: values.ForcePathStyle})
		if e != nil {
			return kernel.Outcome{}, e
		}
		if err = client.Test(ctx); err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "storage_unavailable", "S3 连接失败，请检查 Endpoint、Bucket 和凭据")
		}
	}
	return kernel.Success(200, nil)
}

type readSeekCloser interface {
	io.Reader
	io.Seeker
	io.Closer
}

func (f *Service) openBytes(ctx context.Context, config *ent.FileStorageConfig, key string) (readSeekCloser, error) {
	if config.Provider == "s3" {
		client, err := f.objects(config)
		if err != nil {
			return nil, err
		}
		return client.Open(ctx, key)
	}
	root, err := f.FileStorage.OpenRoot(config.LocalRootPath)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return root.Open(key)
}
func (f *Service) removeBytes(ctx context.Context, config *ent.FileStorageConfig, key string) error {
	if config.Provider == "s3" {
		client, err := f.objects(config)
		if err != nil {
			return err
		}
		return client.Remove(ctx, key)
	}
	root, err := f.FileStorage.OpenRoot(config.LocalRootPath)
	if err != nil {
		return err
	}
	defer root.Close()
	err = root.Remove(key)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (f *Service) lockConfig(ctx context.Context, tx *ent.Tx, id int) (*ent.FileStorageConfig, error) {
	if f.Store.Dialect == dialect.Postgres {
		return tx.FileStorageConfig.Query().Where(filestorageconfig.IDEQ(id)).ForUpdate().Only(ctx)
	}
	return tx.FileStorageConfig.Get(ctx, id)
}
