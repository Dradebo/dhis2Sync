# DHIS2 Sync Distribution Guide

This guide details how to build, sign, and distribute the DHIS2 Sync Desktop application for macOS, Windows, and Linux.

## 1. Prerequisites

Ensure the following are installed on your build machine (or CI/CD environment):
- **Go** (v1.21+)
- **Node.js** (v18+)
- **Wails CLI**: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

## 2. Manual Build (Local)

To build the application manually on your current machine:

```bash
# Build for your current OS
wails build
```

The output binary will be in the `build/bin` directory.

### Cross-Compilation Limitations
- **From Mac**: You can build for Mac (Intel/M1) and Linux. You **cannot** easily build for Windows (requires CGO/MinGW setup).
- **From Windows**: You can build for Windows and Linux. You **cannot** build for Mac.
- **From Linux**: You can build for Linux and Windows. You **cannot** build for Mac.

**Recommendation**: Use **GitHub Actions** (Section 4) to build for all platforms automatically.

## 3. Platform-Specific Details

### 🍏 macOS
- **Output**: `dhis2sync-desktop.app` (Application Bundle)
- **Architecture**:
    - `amd64` (Intel Macs)
    - `arm64` (Apple Silicon/M1/M2)
    - `universal` (Runs on both - Recommended)
- **Command**:
  ```bash
  wails build -platform darwin/universal
  ```
- **Signing (Required)**: macOS will block the app if not signed. You need an Apple Developer ID.
  ```bash
  # Sign the app
  codesign --deep --force --verbose --sign "Developer ID Application: Your Name (TEAMID)" build/bin/dhis2sync-desktop.app
  ```

### 🪟 Windows
- **Output**: `dhis2sync-desktop.exe`
- **Architecture**: `amd64` (Standard 64-bit)
- **Command**:
  ```bash
  wails build -platform windows/amd64
  ```
- **WebView2**: The app relies on WebView2. The Wails installer (NSIS) handles this check automatically if you generate an installer.
- **Signing (Recommended)**: Windows SmartScreen will warn users if unsigned.

### 🐧 Linux
- **Output**: `dhis2sync-desktop` (Binary)
- **Dependencies**: Users need `libwebkit2gtk-4.0-dev` installed.
- **Distribution**: Usually distributed as a `.deb` or `.AppImage`.

## 4. Automated Builds (GitHub Actions)

The best way to distribute is to let GitHub build for all platforms whenever you push a tag (e.g., `v1.0.0`).

### Setup
1. Create a file `.github/workflows/build.yml`.
2. Paste the configuration below.
3. Push to GitHub.
4. Create a release tag: `git tag v1.0.0 && git push origin v1.0.0`.

### Workflow Configuration (`.github/workflows/build.yml`)

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    name: Build for ${{ matrix.os }}
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            platform: linux/amd64
            output: dhis2sync-desktop-linux-amd64
          - os: windows-latest
            platform: windows/amd64
            output: dhis2sync-desktop-windows-amd64.exe
          - os: macos-latest
            platform: darwin/universal
            output: dhis2sync-desktop-mac-universal

    steps:
      - uses: actions/checkout@v3

      - name: Setup Go
        uses: actions/setup-go@v4
        with:
          go-version: '1.21'

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install Wails
        run: go install github.com/wailsapp/wails/v2/cmd/wails@latest

      - name: Install Linux Dependencies
        if: matrix.os == 'ubuntu-latest'
        run: sudo apt-get update && sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev

      - name: Build
        run: |
          wails build -platform ${{ matrix.platform }} -o ${{ matrix.output }} -clean

      - name: Upload Artifact
        uses: actions/upload-artifact@v3
        with:
          name: ${{ matrix.output }}
          path: build/bin/${{ matrix.output }}*

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v3
      
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            **/dhis2sync-desktop-*
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## 5. Distribution Checklist

1.  **[CRITICAL] Database Path**: Ensure `db.go` uses `os.UserConfigDir()` (Already fixed).
2.  **Icons**: Replace `build/appicon.png` and `build/windows/icon.ico` with your branding.
3.  **Metadata**: Update `wails.json` with correct Author, Email, and Version.
4.  **Test**:
    - Build a generic binary: `wails build`.
    - Run it on a clean machine (VM or Sandbox) to verify it starts and creates the database correctly.
