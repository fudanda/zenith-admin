package files

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/fudanda/arcbase/backend/ent"
	"github.com/fudanda/arcbase/backend/internal/kernel"
	"github.com/fudanda/arcbase/backend/internal/storage"
)

// Only encrypted credentials enter this restart-safe compensation journal.
// Jobs retain their original destination even if its configuration is removed.
type objectCleanup struct {
	Key, Region, Endpoint, Bucket, AccessKeyID, SecretCipher, Prefix string
	ForcePathStyle                                                   bool
}

func (f *Service) cleanupRoot() (storage.Root, error) {
	base := f.StagingPath
	if base == "" {
		base = filepath.Join("data", "uploads")
	}
	base, err := filepath.Abs(base)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(base, 0700); err != nil {
		return nil, err
	}
	root, err := f.FileStorage.OpenRoot(base)
	if err != nil {
		return nil, err
	}
	if err = root.MkdirAll(".pending-objects", 0700); err != nil {
		root.Close()
		return nil, err
	}
	return root, nil
}
func (f *Service) compensateObject(ctx context.Context, config *ent.FileStorageConfig, key string) error {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	err := f.removeBytes(cleanup, config, key)
	if err == nil || config.Provider != "s3" {
		return err
	}
	root, openErr := f.cleanupRoot()
	if openErr != nil {
		return errors.Join(err, openErr)
	}
	defer root.Close()
	job := objectCleanup{key, config.S3Region, config.S3Endpoint, config.S3Bucket, config.S3AccessKeyID, config.S3SecretCipher, config.BasePath, config.S3ForcePathStyle}
	payload, _ := json.Marshal(job)
	jobPath := path.Join(".pending-objects", kernel.Digest(config.S3Endpoint+config.S3Bucket+key)+".json")
	temp := jobPath + ".tmp"
	file, openErr := root.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if openErr != nil {
		return errors.Join(err, openErr)
	}
	defer root.Remove(temp)
	_, writeErr := file.Write(payload)
	syncErr := file.Sync()
	closeErr := file.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		return errors.Join(err, writeErr, syncErr, closeErr)
	}
	return errors.Join(err, root.Rename(temp, jobPath))
}
func (f *Service) retryObjectCleanup(ctx context.Context) error {
	root, err := f.cleanupRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	dir, err := root.Open(".pending-objects")
	if err != nil {
		return err
	}
	entries, err := dir.ReadDir(100)
	dir.Close()
	if err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		jobPath := path.Join(".pending-objects", entry.Name())
		file, err := root.Open(jobPath)
		if err != nil {
			continue
		}
		payload, err := io.ReadAll(io.LimitReader(file, 16384))
		file.Close()
		var job objectCleanup
		if err != nil || json.Unmarshal(payload, &job) != nil || !strings.HasPrefix(job.Key, path.Join(job.Prefix, "objects")+"/") {
			continue
		}
		config := &ent.FileStorageConfig{Provider: "s3", S3Region: job.Region, S3Endpoint: job.Endpoint, S3Bucket: job.Bucket, S3AccessKeyID: job.AccessKeyID, S3SecretCipher: job.SecretCipher, S3ForcePathStyle: job.ForcePathStyle}
		if err = f.removeBytes(ctx, config, job.Key); err == nil {
			root.Remove(jobPath)
		}
	}
	return nil
}
