package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/cross/mpod/server/internal/app"
)

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags|log.LUTC)

	application, err := app.New(logger)
	if err != nil {
		logger.Fatal(err)
	}

	runCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := application.Run(runCtx); err != nil {
		logger.Fatal(err)
	}
}
