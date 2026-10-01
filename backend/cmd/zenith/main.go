package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	zenith "github.com/fudanda/zenith-admin/backend"
	"golang.org/x/term"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if os.Args[1] == "serve" {
		framework, err := zenith.New(ctx, zenith.Config{DSN: os.Getenv("ZENITH_DATABASE_URL"), Address: os.Getenv("ZENITH_ADDR"), SecureCookies: os.Getenv("ZENITH_INSECURE_COOKIES") != "true", StorageEncryptionKey: os.Getenv("ZENITH_STORAGE_KEY"), FileStagingPath: os.Getenv("ZENITH_FILE_STAGING_PATH")})
		if err != nil {
			fatal(err)
		}
		defer framework.Shutdown(context.Background())
		if err = framework.Run(ctx); err != nil {
			fatal(err)
		}
		return
	}
	store, err := zenith.OpenStore(ctx, os.Getenv("ZENITH_DATABASE_URL"))
	if err != nil {
		fatal(err)
	}
	defer store.Close()
	switch os.Args[1] {
	case "migrate":
		err = store.Migrate(ctx)
	case "seed":
		err = store.Seed(ctx)
	case "backup-sqlite":
		if len(os.Args) != 3 {
			fatal(fmt.Errorf("usage: zenith backup-sqlite OUTPUT.db"))
		}
		err = store.BackupSQLite(ctx, os.Args[2])
	case "init-admin":
		if len(os.Args) < 3 {
			fatal(fmt.Errorf("usage: zenith init-admin USERNAME < password-file"))
		}
		var password string
		if term.IsTerminal(int(os.Stdin.Fd())) {
			fmt.Fprint(os.Stderr, "Admin password: ")
			secret, readErr := term.ReadPassword(int(os.Stdin.Fd()))
			fmt.Fprintln(os.Stderr)
			if readErr != nil {
				fatal(fmt.Errorf("read password: %w", readErr))
			}
			password = string(secret)
		} else {
			line, readErr := bufio.NewReader(os.Stdin).ReadString('\n')
			if readErr != nil && len(line) == 0 {
				fatal(fmt.Errorf("read password from stdin: %w", readErr))
			}
			password = strings.TrimRight(line, "\r\n")
		}
		err = store.InitAdmin(ctx, os.Args[2], password)
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fatal(err)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: zenith {serve|migrate|seed|init-admin USERNAME|backup-sqlite OUTPUT.db}")
}
func fatal(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
