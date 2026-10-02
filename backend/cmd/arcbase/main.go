package main

import (
	"context"
	"fmt"
	"github.com/fudanda/arcbase/backend/cli"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	config, err := cli.ConfigFromEnvironment()
	if err == nil {
		err = cli.Run(ctx, cli.Options{Args: os.Args[1:], Config: config})
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
