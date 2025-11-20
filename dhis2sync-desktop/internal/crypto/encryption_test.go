package crypto

import (
	"crypto/rand"
	"encoding/base64"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) {
	// Set up test encryption key before running tests
	testKey := make([]byte, 32)
	rand.Read(testKey)
	os.Setenv("ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(testKey))

	// Initialize encryption
	if err := InitEncryption(); err != nil {
		panic("Failed to initialize encryption for tests: " + err.Error())
	}

	// Run tests
	code := m.Run()

	// Clean up
	os.Unsetenv("ENCRYPTION_KEY")
	os.Exit(code)
}

func TestEncryptDecrypt(t *testing.T) {
	t.Run("Should encrypt and decrypt successfully", func(t *testing.T) {
		plaintext := "my-secret-password"

		encrypted, err := Encrypt(plaintext)
		require.NoError(t, err)
		assert.NotEqual(t, plaintext, encrypted)
		assert.NotEmpty(t, encrypted)

		decrypted, err := Decrypt(encrypted)
		require.NoError(t, err)
		assert.Equal(t, plaintext, decrypted)
	})

	t.Run("Should produce different ciphertexts for same plaintext", func(t *testing.T) {
		plaintext := "password123"

		encrypted1, err := Encrypt(plaintext)
		require.NoError(t, err)

		encrypted2, err := Encrypt(plaintext)
		require.NoError(t, err)

		// AES-GCM includes random nonce, so ciphertexts should differ
		assert.NotEqual(t, encrypted1, encrypted2)

		// But both should decrypt to the same plaintext
		decrypted1, err := Decrypt(encrypted1)
		require.NoError(t, err)

		decrypted2, err := Decrypt(encrypted2)
		require.NoError(t, err)

		assert.Equal(t, plaintext, decrypted1)
		assert.Equal(t, plaintext, decrypted2)
	})

	t.Run("Should fail gracefully with invalid ciphertext", func(t *testing.T) {
		_, err := Decrypt("invalid-base64-data!!!")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to decode base64")
	})

	t.Run("Should fail with ciphertext too short", func(t *testing.T) {
		// Create a valid base64 string that's too short
		shortCiphertext := base64.StdEncoding.EncodeToString([]byte("short"))

		_, err := Decrypt(shortCiphertext)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "ciphertext too short")
	})

	t.Run("Should handle empty plaintext", func(t *testing.T) {
		plaintext := ""

		encrypted, err := Encrypt(plaintext)
		require.NoError(t, err)

		decrypted, err := Decrypt(encrypted)
		require.NoError(t, err)
		assert.Equal(t, plaintext, decrypted)
	})

	t.Run("Should handle long plaintext", func(t *testing.T) {
		// Create a 1MB plaintext
		plaintext := string(make([]byte, 1024*1024))

		encrypted, err := Encrypt(plaintext)
		require.NoError(t, err)

		decrypted, err := Decrypt(encrypted)
		require.NoError(t, err)
		assert.Equal(t, len(plaintext), len(decrypted))
	})

	t.Run("Should handle special characters", func(t *testing.T) {
		plaintext := "p@ssw0rd!#$%^&*(){}[]|\\:;<>,.?/~`"

		encrypted, err := Encrypt(plaintext)
		require.NoError(t, err)

		decrypted, err := Decrypt(encrypted)
		require.NoError(t, err)
		assert.Equal(t, plaintext, decrypted)
	})
}

func TestEncryptPassword(t *testing.T) {
	t.Run("EncryptPassword should work as alias for Encrypt", func(t *testing.T) {
		password := "test-password"

		encrypted, err := EncryptPassword(password)
		require.NoError(t, err)
		assert.NotEqual(t, password, encrypted)

		decrypted, err := DecryptPassword(encrypted)
		require.NoError(t, err)
		assert.Equal(t, password, decrypted)
	})
}

func TestDecryptPassword(t *testing.T) {
	t.Run("DecryptPassword should work as alias for Decrypt", func(t *testing.T) {
		password := "secure-password"

		encrypted, err := Encrypt(password)
		require.NoError(t, err)

		decrypted, err := DecryptPassword(encrypted)
		require.NoError(t, err)
		assert.Equal(t, password, decrypted)
	})
}

func TestIsInitialized(t *testing.T) {
	t.Run("Should return true when encryption is initialized", func(t *testing.T) {
		assert.True(t, IsInitialized())
	})
}

func TestInitEncryption(t *testing.T) {
	t.Run("Should initialize with environment variable", func(t *testing.T) {
		// Save current key
		oldKey := encryptionKey

		// Reset encryption
		encryptionKey = nil

		// Set test key
		testKey := make([]byte, 32)
		rand.Read(testKey)
		os.Setenv("ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(testKey))

		err := InitEncryption()
		require.NoError(t, err)
		assert.True(t, IsInitialized())

		// Restore original key
		encryptionKey = oldKey
		os.Unsetenv("ENCRYPTION_KEY")
	})

	t.Run("Should handle raw string as encryption key", func(t *testing.T) {
		// Save current key
		oldKey := encryptionKey

		// Reset encryption
		encryptionKey = nil

		// Set raw string key (will be hashed to 32 bytes)
		os.Setenv("ENCRYPTION_KEY", "test-encryption-key-raw-string")

		err := InitEncryption()
		require.NoError(t, err)
		assert.True(t, IsInitialized())
		assert.Len(t, encryptionKey, 32) // Should be hashed to 32 bytes

		// Restore original key
		encryptionKey = oldKey
		os.Unsetenv("ENCRYPTION_KEY")
	})
}

func TestEncryptWithoutInitialization(t *testing.T) {
	t.Run("Should fail if encryption not initialized", func(t *testing.T) {
		// Save current key
		oldKey := encryptionKey

		// Reset encryption
		encryptionKey = nil

		_, err := Encrypt("test")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "encryption not initialized")

		// Restore
		encryptionKey = oldKey
	})
}

func TestDecryptWithoutInitialization(t *testing.T) {
	t.Run("Should fail if encryption not initialized", func(t *testing.T) {
		// Save current key
		oldKey := encryptionKey

		// Reset encryption
		encryptionKey = nil

		_, err := Decrypt("test")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "encryption not initialized")

		// Restore
		encryptionKey = oldKey
	})
}
