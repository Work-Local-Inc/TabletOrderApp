#!/bin/bash
# NUCLEAR FIX FOR METRO - Run this when Metro hangs

echo "🔧 FIXING METRO..."
echo ""

# Step 1: Kill everything
echo "Step 1: Killing all node/expo processes..."
pkill -9 -f node 2>/dev/null
pkill -9 -f expo 2>/dev/null
pkill -9 -f metro 2>/dev/null
sleep 2

# Step 2: Clear all caches
echo "Step 2: Clearing all caches..."
cd /Users/brianlapp/Documents/GitHub/TabletOrderApp
rm -rf .expo
rm -rf node_modules/.cache
rm -rf /tmp/metro-*
rm -rf /tmp/haste-map-*
rm -rf ~/.expo/cache
watchman watch-del-all 2>/dev/null || true

# Step 3: Verify node version
echo "Step 3: Setting Node 20..."
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
echo "Node version: $(node --version)"

# Step 4: Start Metro
echo ""
echo "Step 4: Starting Metro..."
echo "=========================================="
npx expo start --dev-client --port 8081 --clear





