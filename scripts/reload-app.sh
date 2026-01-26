#!/bin/bash
# Quick reload script - USE THIS after code changes
# Metro must already be running!

echo "🔄 Reloading app on tablet..."

# Force stop and restart
adb shell am force-stop com.anonymous.TabletOrderApp
sleep 1
adb shell am start -n com.anonymous.TabletOrderApp/.MainActivity

echo "✅ App restarted! It will load fresh bundle from Metro."





