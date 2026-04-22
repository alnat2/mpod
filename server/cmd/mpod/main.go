package main

import (
	"log"
	"os"

	"github.com/cross/mpod/server/internal/app"
)

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags|log.LUTC)

	application, err := app.New(logger)
	if err != nil {
		logger.Fatal(err)
	}

	if err := application.Run(); err != nil {
		logger.Fatal(err)
	}
}
