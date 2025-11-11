package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
)

var encryptionKey []byte

// InitEncryption initializes the encryption key from environment variable or keystore
// Priority:
// 1. ENCRYPTION_KEY environment variable (for development/testing)
// 2. System keychain (production - secure storage)
// 3. Generate new key and store in keychain
func InitEncryption() error {
	// Try environment variable first (development/testing)
	keyString := os.Getenv("ENCRYPTION_KEY")
	if keyString != "" {
		// Decode base64 key if provided, or hash the raw string to get 32 bytes
		keyBytes, err := base64.StdEncoding.DecodeString(keyString)
		if err != nil {
			// If decoding fails, use SHA256 hash of the string
			hash := sha256.Sum256([]byte(keyString))
			encryptionKey = hash[:]
		} else {
			// Use decoded key, ensure it's 32 bytes (AES-256)
			if len(keyBytes) != 32 {
				hash := sha256.Sum256(keyBytes)
				encryptionKey = hash[:]
			} else {
				encryptionKey = keyBytes
			}
		}
		return nil
	}

	// No env var, use keystore for production
	key, err := GenerateOrLoadKey()
	if err != nil {
		return fmt.Errorf("failed to initialize encryption from keystore: %w", err)
	}

	encryptionKey = key
	return nil
}

// IsInitialized checks if encryption has been initialized
func IsInitialized() bool {
	return len(encryptionKey) > 0
}

// Encrypt encrypts plaintext using AES-256-GCM
// Returns base64-encoded ciphertext
func Encrypt(plaintext string) (string, error) {
	if len(encryptionKey) == 0 {
		return "", errors.New("encryption not initialized")
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	// Create nonce
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("failed to generate nonce: %w", err)
	}

	// Encrypt and prepend nonce
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)

	// Encode to base64 for storage
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt decrypts base64-encoded ciphertext using AES-256-GCM
// Returns plaintext string
func Decrypt(ciphertextB64 string) (string, error) {
	if len(encryptionKey) == 0 {
		return "", errors.New("encryption not initialized")
	}

	// Decode from base64
	ciphertext, err := base64.StdEncoding.DecodeString(ciphertextB64)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", errors.New("ciphertext too short")
	}

	// Extract nonce and ciphertext
	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]

	// Decrypt
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt: %w", err)
	}

	return string(plaintext), nil
}

// EncryptPassword is a convenience wrapper for encrypting passwords
func EncryptPassword(password string) (string, error) {
	return Encrypt(password)
}

// DecryptPassword is a convenience wrapper for decrypting passwords
func DecryptPassword(encryptedPassword string) (string, error) {
	return Decrypt(encryptedPassword)
}
