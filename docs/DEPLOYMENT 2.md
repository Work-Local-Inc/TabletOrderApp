# TabletOrderApp - Deployment Guide

**Last Updated:** December 15, 2025

---

## ⚠️ AI AGENT: READ THIS FIRST ⚠️

### After Making Code Changes - DO THIS:

```bash
# Step 1: Check if Metro is running (USER runs this in their terminal, not you)
curl -s http://localhost:8081/status
# If "packager-status:running" → Metro is running, go to Step 2
# If nothing → Ask user to run: ./scripts/start-metro.sh

# Step 2: Reload the app (THIS IS ALL YOU NEED TO DO)
adb shell am force-stop com.anonymous.TabletOrderApp && adb shell am start -n com.anonymous.TabletOrderApp/.MainActivity
```

### RULES FOR AI AGENT:
1. **NEVER kill Metro** (`pkill node`, `pkill expo`) unless there's a specific port conflict error
2. **NEVER start Metro in background** - it needs interactive terminal (user runs it)
3. **Metro auto-reloads** on file save - just restart the app to force refresh
4. **If Metro not running** → Ask user to run `./scripts/start-metro.sh` in their terminal
5. **After code changes** → Just run the reload command above

### If App Shows Cached/Old Code:
```bash
# Clear app cache and restart (user will need to re-login)
adb shell pm clear com.anonymous.TabletOrderApp
adb shell am start -n com.anonymous.TabletOrderApp/.MainActivity
# Then re-grant Bluetooth permissions:
adb shell pm grant com.anonymous.TabletOrderApp android.permission.BLUETOOTH_SCAN
adb shell pm grant com.anonymous.TabletOrderApp android.permission.BLUETOOTH_CONNECT
```

---

## Table of Contents
- [Pre-Flight Checklist](#pre-flight-checklist)
- [Quick Start](#quick-start)
- [Two-App Architecture](#two-app-architecture)
- [Fast Development Workflow (30-Second Updates)](#fast-development-workflow-30-second-updates)
- [ADB Wireless Debugging Setup](#adb-wireless-debugging-setup)
- [Environment Variables](#environment-variables)
- [Metro Bundler Configuration](#metro-bundler-configuration)
- [Network Configuration](#network-configuration)
- [Full Rebuild Process (5-10 Minutes)](#full-rebuild-process-5-10-minutes)
- [Quick Reference](#quick-reference)
- [Which Workflow Should I Use?](#which-workflow-should-i-use)
- [Troubleshooting](#troubleshooting)
- [Important Notes](#important-notes)
- [Nuclear Option: Complete Clean Rebuild](#nuclear-option-complete-clean-rebuild)

---

## Pre-Flight Checklist

**Run through this checklist BEFORE every build to avoid hours of debugging:**

### 1. Verify Node Version (CRITICAL)
```bash
node --version
# MUST be v20.x.x - NOT v24 or higher!
```

⚠️ **Node 24+ is NOT compatible with Expo CLI** - causes `TypeError: _debug(...).default.enabled is not a function`

**To use correct Node version:**
```bash
# Use Homebrew's Node 20 (RECOMMENDED - more reliable than nvm)
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"

# Verify
node --version  # Should show v20.x.x
```

### 2. Verify Environment Variables
```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"

# Verify
echo $ANDROID_HOME  # Should show: /Users/brianlapp/Library/Android/sdk
echo $JAVA_HOME     # Should show: /Applications/Android Studio.app/Contents/jbr/Contents/Home
```

### 3. Verify Device Connected
```bash
adb devices
# Should show device ID with "device" status, e.g.:
# R83X9015ZWN    device
```

### 4. Verify Entry Point
```bash
# package.json should have:
cat package.json | grep '"main"'
# Should show: "main": "index.js"

# Ensure NO duplicate entry point:
ls index.ts 2>/dev/null && echo "⚠️ DELETE index.ts - only index.js should exist!" || echo "✅ Good - only index.js exists"
```

### 5. Check node_modules Health
```bash
# If you see permission errors or corrupted packages, clean reinstall:
rm -rf node_modules
npm install --legacy-peer-deps
```

### All-In-One Pre-Flight Command
```bash
cd /Users/brianlapp/Documents/GitHub/TabletOrderApp
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
echo "Node: $(node --version)"
echo "Device: $(adb devices | tail -1)"
echo "Entry: $(cat package.json | grep '"main"')"
```

---

## Quick Start

**Assumes ADB already connected and debug build installed:**

```bash
cd /Users/brianlapp/Documents/GitHub/TabletOrderApp
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
npx expo start --dev-client --port 8081
```

Then open "Restaurant Order Tablet" on tablet. Changes auto-reload in ~30 seconds.

If this doesn't work, see [Troubleshooting](#troubleshooting).

---

## CRITICAL: If App Shows "Unable to load script" Error

This is the most common issue. The app caches the Metro URL and if your Mac's IP changed, it fails.

**Quick Fix (copy-paste this):**
```bash
# Set up USB port forwarding
adb reverse tcp:8081 tcp:8081

# Clear cached bundler URL
adb shell pm clear com.anonymous.TabletOrderApp

# Restart app
adb shell am start -n com.anonymous.TabletOrderApp/.MainActivity
```

This clears the cached IP and forces the app to use `localhost:8081` via USB.

---

## Two-App Architecture

| Aspect | Expo Go | Restaurant Order Tablet (Standalone) |
|--------|---------|-------------------------------------|
| Purpose | Development testing | Production use |
| Bluetooth Printing | ❌ No (missing native module) | ✅ Yes (compiled native module) |
| UI Updates | Always from Metro (live) | From bundled JS OR Metro (if connected) |
| Installation | App Store download | Built via `npx expo run:android --device` |
| Use Case | Quick UI testing without printer | Full feature testing with printer |

**Key Points:**
- Expo Go is useful for rapid UI iteration but **cannot test printing**
- Standalone app can connect to Metro for fast updates AND has printing capability
- Both apps can load from Metro during development
- Standalone app bundles JS when built, but can override with Metro connection
- **The standalone app MUST be a debug build to connect to Metro**

---

## Fast Development Workflow (30-Second Updates)

### Prerequisites
- Tablet and Mac on same WiFi network
- ADB wireless debugging enabled and connected
- **Debug build** of standalone app installed on tablet (NOT release build)

### Step-by-Step Process

**1. Start Metro Bundler:**
```bash
cd /Users/brianlapp/Documents/GitHub/TabletOrderApp
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
npx expo start --dev-client
```

**2. Connect Standalone App to Metro:**
- Open "Restaurant Order Tablet" app on tablet
- Shake device or press menu button
- Select "Settings" → "Change Bundle Location"
- Enter: `192.168.0.149:8081` (your Mac's IP)
- Tap "Reload"

**3. Make Changes:**
- Edit code in your editor
- Save file
- App hot-reloads in ~30 seconds
- Test printing, UI, and all features

### Visual Flow
```
Developer (Mac)          Metro Bundler           Tablet App
      |                       |                      |
      |-- npx expo start ---->|                      |
      |                       |<---- Connect --------|
      |                       |---- Send bundle ---->|
      |                       |                      |
      |-- Edit & save ------->|                      |
      |                       |-- Rebuild bundle --->|
      |                       |---- Push update ---->|
      |                       |                      |
      |                       |     (30 seconds)     |
```

---

## ADB Wireless Debugging Setup

### Understanding Pairing vs Connect
- **Pairing Port:** One-time authentication (generates new each time)
- **Connect Port:** Persistent connection for development (stays same)
- You pair ONCE, then connect each session

### Initial Setup (One-Time)

**On Tablet:**
1. Settings → About Tablet → Tap "Build Number" 7 times (enables Developer Options)
2. Settings → System → Developer Options → Enable
3. Developer Options → Wireless Debugging → Enable
4. Tap "Pair device with pairing code"
5. Note the pairing code and IP:PORT (e.g., `192.168.0.152:37891`)

**On Mac Terminal:**
```bash
# Pair with the pairing port
adb pair 192.168.0.152:37891
# Enter the 6-digit code when prompted

# After pairing succeeds, go back to tablet
# Tap back to see "Wireless Debugging" main screen
# Note the different IP:PORT under "IP address & Port" (e.g., 192.168.0.152:33259)

# Connect using the connect port
adb connect 192.168.0.152:33259

# Verify connection
adb devices
# Should show: 192.168.0.152:33259    device
```

### Daily Reconnection
```bash
# If connection drops, just reconnect (no pairing needed)
adb connect 192.168.0.152:33259

# Verify
adb devices
```

### USB Connection (Alternative)
```bash
# With tablet connected via USB cable
adb devices
# Should show device serial number

# Set up reverse port forwarding (Metro -> Tablet)
adb reverse tcp:8081 tcp:8081
```

---

## Environment Variables

### Required Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `PATH` | `/opt/homebrew/opt/node@20/bin:$PATH` | Use Node 20 from Homebrew |
| `ANDROID_HOME` | `$HOME/Library/Android/sdk` | Android SDK location |
| `JAVA_HOME` | `/Applications/Android Studio.app/Contents/jbr/Contents/Home` | Java runtime for Gradle |

⚠️ **IMPORTANT: Use Homebrew Node 20, NOT nvm!**
- nvm can have conflicts with `.npmrc` settings causing build failures
- Homebrew's Node 20 is more reliable for this project
- Node 24+ is NOT compatible with Expo CLI

### Setting Variables

**For single session:**
```bash
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
```

**For permanent setup (add to ~/.zshrc):**
```bash
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
echo 'export ANDROID_HOME="$HOME/Library/Android/sdk"' >> ~/.zshrc
echo 'export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"' >> ~/.zshrc
source ~/.zshrc
```

### Verification
```bash
node --version  # Should show v20.x.x
echo $ANDROID_HOME  # Should show SDK path
echo $JAVA_HOME  # Should show Java path
```

---

## Metro Bundler Configuration

### Configuration File
- Location: `metro.config.js`
- Extends default Expo Metro config

### Metro Commands

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `npx expo start` | Start Metro for Expo Go | Quick UI testing without printing |
| `npx expo start --dev-client` | Start Metro for standalone app | Development with printing capability |
| `npx expo start --clear` | Clear Metro cache and start | After dependency changes or errors |

### Metro Connection
- Default port: `8081`
- Accessible at: `http://<MAC_IP>:8081`
- Standalone app connects via "Change Bundle Location" menu or auto-discovers via ADB

---

## Network Configuration

### Current Configuration
- Mac IP: `192.168.0.149` (may change if DHCP reassigns)
- Tablet IP: `192.168.0.152` (may change if DHCP reassigns)
- Metro Port: `8081` (fixed)

### Finding Your Mac's IP
```bash
# Terminal
ipconfig getifaddr en0  # For WiFi
# or
ifconfig | grep "inet " | grep -v 127.0.0.1
```

### Finding Tablet's IP
- Settings → About Tablet → Status → IP Address
- Or check Wireless Debugging screen (shows IP:PORT)

### Network Requirements
- Both devices on same WiFi network
- No VPN active on Mac (can block local connections)
- Firewall allows incoming connections on port 8081
- Router allows device-to-device communication (not guest network)

---

## Full Rebuild Process (5-10 Minutes)

### When to Rebuild
- Added/removed native dependencies
- Changed Android permissions in `app.json`
- Changed native configuration
- Current app is release build (need debug build for Metro)
- Want to bundle latest JS into APK (for offline use)

### How to Check if Rebuild Needed
```bash
# Check if current app is debuggable
adb shell "run-as com.anonymous.TabletOrderApp ls 2>&1"
# If it says "package not debuggable" -> NEED TO REBUILD
# If it shows files -> debug build, Metro should work
```

### Rebuild Steps

**1. Ensure ADB Connected:**
```bash
adb devices
# Should show tablet connected
```

**2. Kill Metro (if running):**
```bash
pkill -9 node
```

**3. Set Environment Variables:**
```bash
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
```

**4. Run Build:**
```bash
cd /Users/brianlapp/Documents/GitHub/TabletOrderApp
npx expo run:android --device
```

**5. Wait for Gradle:**
- First build: 10-15 minutes
- Subsequent builds: 5-10 minutes
- Progress shown in terminal

**6. Verify Installation:**
- App auto-installs on tablet
- Look for "Restaurant Order Tablet" app
- Open and test

### Build Output
- APK location: `android/app/build/outputs/apk/debug/app-debug.apk`
- Can be manually installed with: `adb install -r <path-to-apk>`

---

## Quick Reference

### Common Commands
```bash
# Start development
npx expo start --dev-client

# Connect ADB (wireless)
adb connect <TABLET_IP>:<PORT>

# Connect ADB (USB) with port forwarding
adb reverse tcp:8081 tcp:8081

# Check ADB connection
adb devices

# Check if app is debug build
adb shell "run-as com.anonymous.TabletOrderApp ls 2>&1"

# Kill Metro
pkill -9 node

# Full rebuild (debug build)
npx expo run:android --device

# Clear Metro cache
npx expo start --clear
```

### Important IPs & Ports
- Mac IP: `192.168.0.149` (update if changed)
- Tablet IP: `192.168.0.152` (update if changed)
- Metro Port: `8081`
- ADB Connect Port: `33259` (update if changed)

### Device Info
- Tablet Serial: `R83X9015ZWN`
- Tablet Model: `SM_X110` (Samsung Galaxy Tab)
- Use model name for non-interactive builds: `npx expo run:android -d SM_X110`

### Key Files
- `app.json` - App configuration, permissions
- `package.json` - Dependencies, scripts
- `metro.config.js` - Metro bundler config

---

## Which Workflow Should I Use?

### Decision Guide

| Scenario | Recommended Workflow | Time |
|----------|---------------------|------|
| Testing UI changes only | Expo Go | Instant |
| Testing printing for first time | Full Rebuild | 5-10 min |
| Daily development with printing | Fast Development (Metro) | 30 sec |
| Changed native dependencies | Full Rebuild | 5-10 min |
| Changed Android permissions | Full Rebuild | 5-10 min |
| Changed JS/UI code only | Fast Development (Metro) | 30 sec |
| App shows "package not debuggable" | Full Rebuild | 5-10 min |

### Quick Decision
1. **Need to test printing?** No → Use Expo Go. Yes → Continue
2. **Debug build installed?** No → Full Rebuild. Yes → Continue
3. **Changed native code/deps?** Yes → Full Rebuild. No → Fast Development

---

## Troubleshooting

### Issue: Metro won't start
- **Symptom:** Port 8081 already in use
- **Solution:** `pkill -9 node` then restart Metro

### Issue: Tablet not showing in adb devices
- **Symptom:** `adb devices` shows empty or offline
- **Solution:**
  1. Check Wireless Debugging is enabled on tablet
  2. Run `adb connect <TABLET_IP>:<PORT>`
  3. Accept authorization prompt on tablet

### Issue: Standalone app shows old UI / doesn't update
- **Symptom:** Changes not appearing in app
- **Solution:**
  1. Check if app is debug build: `adb shell "run-as com.anonymous.TabletOrderApp ls 2>&1"`
  2. If "package not debuggable" → **REBUILD with `npx expo run:android --device`**
  3. If debug build, verify Metro is running
  4. Check bundle location in app (shake → Settings)
  5. Ensure Mac IP is correct

### Issue: "Unable to connect to Metro" / "Unable to load script"
- **Symptom:** App shows red error screen saying "Unable to load script" or trying to connect to wrong IP
- **Root Cause:** App caches the last Metro URL. If your Mac's IP changed, it tries the old IP.
- **Solution (PROVEN FIX):**
  ```bash
  # 1. Make sure Metro is running on port 8081
  # 2. Set up USB port forwarding
  adb reverse tcp:8081 tcp:8081
  
  # 3. Clear app data to reset cached bundler URL
  adb shell pm clear com.anonymous.TabletOrderApp
  
  # 4. Restart the app
  adb shell am start -n com.anonymous.TabletOrderApp/.MainActivity
  ```
- **Why this works:** Clearing app data removes the cached WiFi IP. The app then uses `localhost:8081` which works via USB port forwarding.

### Issue: Build fails with Gradle error
- **Symptom:** `npx expo run:android` fails
- **Solution:**
  1. Verify environment variables are set
  2. Check Android SDK is installed
  3. Try `cd android && ./gradlew clean`
  4. Delete `android` folder and rebuild: `rm -rf android && npx expo run:android --device`

### Issue: npm install fails with peer dependency errors
- **Symptom:** ERESOLVE unable to resolve dependency tree
- **Solution:** Use legacy peer deps: `npm install --legacy-peer-deps`

### Issue: Node version incompatibility (COMMON!)
- **Symptom:** `TypeError: _debug(...).default.enabled is not a function` or other cryptic errors
- **Root Cause:** Using Node 24+ which is incompatible with Expo CLI
- **Solution:**
  ```bash
  # Use Homebrew's Node 20 instead of system/nvm Node
  export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
  node --version  # Verify: should be v20.x.x
  ```
- **Note:** Do NOT use nvm for this project - Homebrew Node 20 is more reliable

### Issue: nvm conflicts with npm
- **Symptom:** `Your user's .npmrc file has a globalconfig and/or prefix setting, which are incompatible with nvm`
- **Solution:** Either fix .npmrc or use Homebrew Node instead:
  ```bash
  # Option 1: Fix nvm (if you must use it)
  nvm use --delete-prefix v20.19.6
  
  # Option 2: Just use Homebrew Node (RECOMMENDED)
  export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
  ```

### Issue: Corrupted node_modules
- **Symptom:** `SyntaxError: Unexpected end of JSON input` or permission denied errors
- **Solution:**
  ```bash
  # Remove corrupted modules (may need sudo if permission issues)
  sudo rm -rf node_modules
  
  # Fresh install
  npm install --legacy-peer-deps
  ```

### Issue: Corrupted gradle-wrapper.jar
- **Symptom:** `Error: Invalid or corrupt jarfile gradle-wrapper.jar`
- **Solution:**
  ```bash
  # Let Expo regenerate the android folder
  rm -rf android
  npx expo run:android --device
  ```

### Issue: TS5083 TypeScript error on index.ts
- **Symptom:** `error TS5083: Cannot read file 'index.ts'` or duplicate entry point errors
- **Root Cause:** Both `index.ts` and `index.js` exist in project root
- **Solution:**
  ```bash
  # Delete index.ts, keep only index.js
  rm index.ts
  
  # Verify package.json has correct entry point
  cat package.json | grep '"main"'
  # Should show: "main": "index.js"
  ```

### Issue: Device not found in non-interactive mode
- **Symptom:** `CommandError: Input is required, but 'npx expo' is in non-interactive mode. Required input: > Select a device/emulator`
- **Solution:**
  ```bash
  # First verify device is connected
  adb devices -l
  # Note the model name (e.g., SM_X110)
  
  # Run build with device model name
  npx expo run:android -d SM_X110
  ```

---

## Important Notes

### About Debug vs Release Builds
- **Debug build:** Can connect to Metro, supports hot reload, has shake menu
- **Release build:** Standalone, faster, but NO Metro connection
- If Metro updates stop working, check if someone installed a release build
- Always use `npx expo run:android --device` for development (creates debug build)

### About the Two Apps
- You will see TWO apps on your tablet: "Expo Go" and "Restaurant Order Tablet"
- Expo Go: Downloaded from Play Store, cannot print
- Restaurant Order Tablet: Built by you, can print
- Use Restaurant Order Tablet for all development once built

### About Metro Connection
- Standalone app remembers last bundle location
- If Metro stops, app will show "Unable to connect"
- Restart Metro and reload app to reconnect
- Bundle location persists across app restarts

### About IP Addresses
- DHCP may reassign IPs when devices reconnect to WiFi
- If connection breaks, check if Mac IP changed
- Update bundle location in app if IP changed
- Consider setting static IP on router for Mac

### About ADB Connection
- ADB connection can drop after tablet sleeps
- Just reconnect with `adb connect` command
- No need to re-pair unless tablet is reset
- Keep tablet plugged in during development to prevent sleep

### About Builds
- Full rebuild bundles current JS into APK
- After rebuild, app works offline (uses bundled JS)
- Connecting to Metro overrides bundled JS
- Disconnect from Metro to test bundled version

---

## Nuclear Option: Complete Clean Rebuild

**When nothing else works, do a full clean rebuild:**

```bash
# 1. Set correct Node version
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"

# 2. Verify Node
node --version  # Must be v20.x.x

# 3. Navigate to project
cd /Users/brianlapp/Documents/GitHub/TabletOrderApp

# 4. Kill any running processes
pkill -9 node 2>/dev/null

# 5. Clean everything
sudo rm -rf node_modules
rm -rf android/build
rm -rf .expo

# 6. Fresh install
npm install --legacy-peer-deps

# 7. Verify device connected
adb devices

# 8. Build (this will regenerate android/ if needed)
npx expo run:android -d SM_X110
```

**Expected timeline:** 5-15 minutes depending on cache state

**Success criteria:**
- Build reaches 100% without TS5083 or other errors
- App installs on tablet automatically
- App opens and shows current UI/logo
