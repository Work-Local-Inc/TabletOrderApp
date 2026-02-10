# PLAN: Deploy Square UI to Standalone App

**Created:** Monday Dec 1, 2025  
**Goal:** Get the Square UI (currently working in Expo Go) deployed to the standalone "Restaurant Order Tablet" app so we can test actual Bluetooth printing

---

## Current State

| App | UI Version | Loads From | Can Print? |
|-----|------------|------------|------------|
| Expo Go | ✅ Square UI | Metro (live) | ❌ No (missing native Bluetooth module) |
| Restaurant Order Tablet (standalone) | ❌ Simple UI | Bundled APK | ✅ Yes (has native Bluetooth compiled) |

**The Problem:** Square UI only exists in Expo Go which CAN'T print. Standalone app CAN print but has OLD Simple UI.

---

## Known Issues in Square UI (seen today in Expo Go)

1. **Printer scan button not working** - Fixed by removing permission check that was hanging
2. **Orders not being fetched** - Need valid API credentials
3. **UI looks incredible** - No changes needed to appearance

---

## Step-by-Step Plan

### Phase 1: Verify Square UI Code is Ready
- [ ] Confirm OrdersListScreen.tsx has Square UI render code (uses OrderListItem, OrderDetailPanel)
- [ ] Confirm all Square components exist in src/components/orders/
- [ ] Confirm theme files exist in src/theme/
- [ ] Test in Expo Go one more time to verify UI loads

### Phase 2: Fix Known Issues
- [ ] Ensure printer scan works (permission check already removed)
- [ ] Verify API credentials are valid (test with curl)
- [ ] Add error handling for failed order fetches

### Phase 3: Connect ADB Over WiFi
- [ ] On tablet: Settings → Developer Options → Wireless Debugging → Enable
- [ ] On tablet: Tap "Pair device with pairing code" to get IP:PORT and pairing code
- [ ] On Mac: Run `adb pair <IP>:<PORT>` with the pairing code
- [ ] On Mac: Run `adb connect <IP>:<PORT>` (the connect port, not pairing port)
- [ ] Verify: `adb devices` shows the tablet

### Phase 4: Rebuild Standalone App
- [ ] Kill Metro if running
- [ ] Run: `npx expo run:android --device`
- [ ] Wait for Gradle build (5-10 mins)
- [ ] App auto-installs on tablet with NEW Square UI + Bluetooth printing capability

### Phase 5: Test
- [ ] Open rebuilt "Restaurant Order Tablet" app
- [ ] Verify Square UI loads
- [ ] Login with valid credentials
- [ ] Go to Settings → Scan for Printers
- [ ] Connect to Bluetooth printer
- [ ] Test print an order

---

## Key Files

| File | Purpose |
|------|---------|
| `src/screens/OrdersListScreen.tsx` | Main screen - must use Square components |
| `src/components/orders/` | Square UI components (OrderListItem, OrderDetailPanel, etc.) |
| `src/theme/ThemeContext.tsx` | Dark/light mode theming |
| `src/services/printService.ts` | Bluetooth printing logic |
| `src/screens/SettingsScreen.tsx` | Printer connection UI |

---

## Commands Reference

```bash
# Connect ADB over WiFi (after pairing)
adb pair <IP>:<PAIRING_PORT>   # Enter pairing code when prompted
adb connect <IP>:<CONNECT_PORT>

# Build and install
cd /Users/brianlapp/Documents/GitHub/TabletOrderApp
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
npx expo run:android --device

# Test API
curl -X POST "https://39d6a4b9-a0f2-4544-a607-a9203b1fa6a8-00-1qkpr2vwm16p5.riker.replit.dev/api/tablet/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"device_uuid": "YOUR_UUID", "device_key": "YOUR_KEY"}'
```

---

## Success Criteria

1. ✅ Standalone app shows Square UI (split view with order list + detail panel)
2. ✅ Can login with valid credentials
3. ✅ Orders load and display
4. ✅ Can scan and connect to Bluetooth printer
5. ✅ Can print a test receipt
6. ✅ Can print an actual order

---

## Notes

- Expo Go CANNOT print - it doesn't have the native Bluetooth module
- Standalone app CAN print - native module is compiled in
- Both load JS from Metro during development, BUT standalone needs rebuild to bundle new JS into APK
- WiFi ADB requires initial pairing (one-time setup per device)

