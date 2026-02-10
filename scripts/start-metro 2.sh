#!/bin/bash
# Start Metro bundler - run this ONCE at start of dev session
# Keep this terminal open!

cd /Users/brianlapp/Documents/GitHub/TabletOrderApp
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"

echo "🚀 Starting Metro bundler..."
echo "Keep this terminal open! Press 'a' to open on Android."
echo ""

npx expo start --dev-client --port 8081





