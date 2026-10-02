package main

import (
 "context"
 "embed"
 "fmt"
 "io/fs"
 "os"
 "os/signal"
 "syscall"
 "github.com/fudanda/zenith-admin/backend/cli"
)

//go:embed all:dashboard
var dashboard embed.FS

func main() {
 ctx,stop:=signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM);defer stop()
 config,err:=cli.ConfigFromEnvironment()
 if err==nil { config.DashboardFS,err=fs.Sub(dashboard,"dashboard") }
 config.Modules=configuredModules()
 if err==nil { err=cli.Run(ctx,cli.Options{Args:os.Args[1:],Config:config}) }
 if err!=nil { fmt.Fprintln(os.Stderr,err);os.Exit(1) }
}
