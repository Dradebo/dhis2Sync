.PHONY: test test-unit test-integration test-coverage test-watch build clean

# Default target
all: test build

# Run all tests
test: test-unit test-integration

# Run unit tests only (fast)
test-unit:
	@echo "Running unit tests..."
	go test -v -short ./internal/...

# Run integration tests only
test-integration:
	@echo "Running integration tests..."
	go test -v -run Integration ./internal/...

# Run tests with coverage report
test-coverage:
	@echo "Running tests with coverage..."
	go test -coverprofile=coverage.out ./internal/...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report generated: coverage.html"

# Run tests for a specific package
test-pkg:
ifndef PKG
	@echo "Usage: make test-pkg PKG=./internal/services/transfer"
	@exit 1
endif
	go test -v $(PKG)

# Watch mode - requires reflex (go install github.com/cespare/reflex@latest)
test-watch:
	@command -v reflex >/dev/null 2>&1 || { echo "reflex not installed. Run: go install github.com/cespare/reflex@latest"; exit 1; }
	reflex -r '\.go$$' -- go test -v ./internal/...

# Build the application
build:
	@echo "Building application..."
	wails build

# Build for development
dev:
	@echo "Starting development server..."
	wails dev

# Clean build artifacts and test cache
clean:
	@echo "Cleaning..."
	go clean -testcache
	rm -f coverage.out coverage.html
	rm -rf build/

# Install test dependencies
deps:
	@echo "Installing test dependencies..."
	go get github.com/stretchr/testify/assert
	go get github.com/stretchr/testify/mock
	go get github.com/DATA-DOG/go-sqlmock
	go mod tidy

# Lint code (requires golangci-lint)
lint:
	@command -v golangci-lint >/dev/null 2>&1 || { echo "golangci-lint not installed. See: https://golangci-lint.run/usage/install/"; exit 1; }
	golangci-lint run ./...

# Format code
fmt:
	@echo "Formatting code..."
	go fmt ./...

# Run tests with race detector
test-race:
	@echo "Running tests with race detector..."
	go test -race -short ./internal/...

# Generate test coverage badge
coverage-badge:
	@go test -coverprofile=coverage.out ./internal/... > /dev/null 2>&1
	@total=$$(go tool cover -func=coverage.out | grep total | awk '{print $$3}' | sed 's/%//'); \
	echo "Total coverage: $$total%"; \
	if [ $$(echo "$$total >= 80" | bc) -eq 1 ]; then \
		echo "✅ Coverage goal met (80%+)"; \
	else \
		echo "⚠️  Coverage below 80%"; \
	fi

# Help target
help:
	@echo "Available targets:"
	@echo "  make test              - Run all tests (unit + integration)"
	@echo "  make test-unit         - Run unit tests only (fast)"
	@echo "  make test-integration  - Run integration tests only"
	@echo "  make test-coverage     - Run tests with HTML coverage report"
	@echo "  make test-watch        - Run tests in watch mode (requires reflex)"
	@echo "  make test-race         - Run tests with race detector"
	@echo "  make build             - Build production application"
	@echo "  make dev               - Start development server"
	@echo "  make clean             - Clean build artifacts and test cache"
	@echo "  make deps              - Install test dependencies"
	@echo "  make lint              - Lint code (requires golangci-lint)"
	@echo "  make fmt               - Format code with go fmt"
	@echo "  make help              - Show this help message"
