package crypto

import (
	"crypto/rand"
	"errors"
	"fmt"
	"runtime"

	"github.com/zalando/go-keyring"
)

const (
	keystoreService = "dhis2sync-desktop"
	keystoreUser    = "encryption-key"
)

// GenerateOrLoadKey generates a new encryption key or loads from system keychain
// Returns 32 bytes for AES-256
func GenerateOrLoadKey() ([]byte, error) {
	// Try to load existing key from keychain
	keyString, err := keyring.Get(keystoreService, keystoreUser)
	if err == nil && keyString != "" {
		// Key exists, decode it
		return []byte(keyString), nil
	}

	// Key doesn't exist or error occurred, generate new one
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		// Real error (not just "not found"), log it
		fmt.Printf("Keystore warning: %v\n", err)
	}

	// Generate new 32-byte key for AES-256
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("failed to generate random key: %w", err)
	}

	// Store in keychain for future use
	if err := keyring.Set(keystoreService, keystoreUser, string(key)); err != nil {
		// Keychain storage failed, warn but continue
		// On Linux without keyring, this might fail - that's OK for dev
		fmt.Printf("WARNING: Failed to store key in keychain: %v\n", err)
		fmt.Println("Key will be regenerated on next app launch")

		// On macOS/Windows this is a real problem
		if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
			return nil, fmt.Errorf("keychain storage required on %s: %w", runtime.GOOS, err)
		}
	}

	return key, nil
}

// DeleteKey removes the encryption key from the keychain
// Useful for testing or reset scenarios
func DeleteKey() error {
	return keyring.Delete(keystoreService, keystoreUser)
}

// IsKeyStored checks if an encryption key exists in the keychain
func IsKeyStored() bool {
	_, err := keyring.Get(keystoreService, keystoreUser)
	return err == nil
}
