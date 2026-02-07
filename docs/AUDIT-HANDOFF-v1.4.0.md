# Audit Handoff: v1.4.0 - Remote Updates, Crash Reporting, and Stuck Order Detection

**Date:** February 7, 2026  
**Version:** 1.4.0 (versionCode 7)  
**Auditor:** Please review all changes thoroughly before production build

---

## Summary of Changes

This release adds three major capabilities:
1. **EAS Update (OTA)** - Over-the-air JavaScript updates without Play Store
2. **Sentry Error Reporting** - Remote crash and error visibility
3. **Stuck Order Detection** - Proactive alerts for unacknowledged orders

---

## Files Created (NEW)

### 1. `src/hooks/useAppUpdates.ts`
**Purpose:** Hook to check for and apply OTA updates from EAS Update

**Review Focus:**
- Check `__DEV__` guard prevents update checks in development
- Verify try/catch prevents crashes if update check fails
- Confirm auto-reload behavior is appropriate for kiosk mode
- Review AppState listener cleanup

```typescript
// Key safety patterns to verify:
if (__DEV__) { return; }  // Line 27 - dev guard
try { ... } catch (error) { ... }  // Lines 35-54 - error handling
subscription.remove();  // Line 77 - cleanup
```

---

### 2. `src/config/sentry.ts`
**Purpose:** Sentry SDK configuration and helper utilities

**Review Focus:**
- Verify DSN placeholder is NOT a real value (security)
- Check `beforeSend` filter correctly excludes network errors
- Confirm `sendDefaultPii: false` prevents PII leakage
- Review all `__DEV__` guards

**CRITICAL:** Line 7 must remain `'YOUR_SENTRY_DSN_HERE'` until user provides real DSN

```typescript
// Security patterns to verify:
sendDefaultPii: false,  // Line 41 - no PII
Sentry.setUser({ id: restaurantId });  // Line 70 - only ID, no name/email
```

---

### 3. `src/components/ErrorBoundary.tsx`
**Purpose:** React error boundary that catches component crashes

**Review Focus:**
- Verify Sentry.captureException is called with component stack
- Check reload behavior uses Updates.reloadAsync in production
- Confirm fallback UI is user-friendly

```typescript
// Error reporting pattern:
Sentry.withScope((scope) => {
  scope.setExtra('componentStack', errorInfo.componentStack);
  Sentry.captureException(error);
});
```

---

### 4. `src/utils/stuckOrderDetection.ts`
**Purpose:** Detect orders stuck in status for too long

**Review Focus:**
- Verify threshold values are appropriate:
  - `pending: 5` minutes (new order not acknowledged)
  - `confirmed: 15` minutes
  - `preparing: 30` minutes
  - `ready: 20` minutes
- Check `IGNORED_STATUSES` includes all terminal states
- Confirm time calculation is correct (Date.now() vs order.updated_at)

```typescript
// Threshold logic to verify:
const STUCK_THRESHOLDS = {
  pending: 5,       // 5 min - CRITICAL for restaurant
  confirmed: 15,    // 15 min
  preparing: 30,    // 30 min
  ready: 20,        // 20 min
};
```

---

## Files Modified (EXISTING)

### 5. `package.json`
**Changes:** Added dependencies

```diff
+ "expo-updates": "~0.28.18",
+ "expo-keep-awake": "~15.0.8",
+ "@sentry/react-native": "~6.22.0",
```

**Review Focus:**
- Verify versions are compatible with Expo SDK 54
- Check no security vulnerabilities in added packages

---

### 6. `app.json`
**Changes:** Added OTA update configuration

```diff
+ "version": "1.4.0",
+ "runtimeVersion": { "policy": "appVersion" },
+ "updates": {
+   "enabled": true,
+   "checkAutomatically": "ON_LOAD",
+   "fallbackToCacheTimeout": 5000,
+   "url": "https://u.expo.dev/a8b29fb9-0480-49fb-b993-b008bfb974bf"
+ },
+ "plugins": [..., "expo-updates"]
```

**Review Focus:**
- Verify projectId matches the actual Expo project
- Check `fallbackToCacheTimeout` of 5000ms is appropriate

---

### 7. `eas.json`
**Changes:** Added channels for update targeting

```diff
  "development": {
+   "channel": "development",
  },
  "preview": {
+   "channel": "preview",
  },
  "production": {
+   "channel": "production",
  }
```

**Review Focus:**
- Verify channels align with intended deployment strategy

---

### 8. `App.tsx`
**Changes:** Integrated Sentry, ErrorBoundary, and useAppUpdates

```diff
+ import { useAppUpdates } from './src/hooks/useAppUpdates';
+ import { ErrorBoundary } from './src/components/ErrorBoundary';
+ import { initSentry, setSentryContext, addBreadcrumb } from './src/config/sentry';
+ import { useStore } from './src/store/useStore';

+ initSentry();  // Before React code

  const AppContent = () => {
+   const { auth } = useStore();
+   useAppUpdates();  // Check for OTA updates
    
+   useEffect(() => {
+     if (auth.isAuthenticated && auth.restaurantId) {
+       setSentryContext(...);
+       addBreadcrumb('User authenticated', 'auth', ...);
+     }
+   }, [...]);
  };

  export default function App() {
    return (
      <SafeAreaProvider>
        <ThemeProvider>
+         <ErrorBoundary>
            <AppContent />
+         </ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }
```

**Review Focus:**
- Verify `initSentry()` is called BEFORE React rendering
- Check ErrorBoundary wraps correct component level
- Confirm useStore dependency doesn't cause render loops

---

### 9. `src/hooks/index.ts`
**Changes:** Export new hook

```diff
+ export { useAppUpdates } from './useAppUpdates';
```

---

### 10. `src/types/index.ts`
**Changes:** Added StuckOrderInfo type and extended HeartbeatPayload

```diff
+ export interface StuckOrderInfo {
+   order_id: string;
+   order_number: string;
+   status: OrderStatus;
+   minutes_stuck: number;
+   created_at: string;
+ }

  export interface HeartbeatPayload {
    ...
+   stuck_orders?: StuckOrderInfo[];
  }
```

**Review Focus:**
- Verify StuckOrderInfo matches backend expectations
- Check optional `stuck_orders` field doesn't break existing API

---

### 11. `src/hooks/useHeartbeat.ts`
**Changes:** Added stuck order detection to heartbeat

```diff
+ import { detectStuckOrders } from '../utils/stuckOrderDetection';
- const APP_VERSION = '1.0.0';
+ const APP_VERSION = '1.4.0';

  const sendHeartbeat = useCallback(async () => {
+   const stuckOrders = detectStuckOrders(orders.orders);
+   if (stuckOrders.length > 0) {
+     console.log('[Heartbeat] Detected stuck orders:', stuckOrders.length);
+   }

    const response = await apiClient.sendHeartbeat({
      ...
-     printer_status: settings.printerConnected ? 'online' : 'offline',
+     printer_status: settings.printerConnected ? 'connected' : 'disconnected',
+     stuck_orders: stuckOrders.length > 0 ? stuckOrders : undefined,
    });
- }, [...]);
+ }, [..., orders.orders]);
```

**Review Focus:**
- Verify `orders.orders` in dependency array doesn't cause excessive re-renders
- Check printer_status value change from 'online'/'offline' to 'connected'/'disconnected' matches API expectations
- Confirm empty array is sent as `undefined`, not `[]`

---

### 12. `src/api/client.ts`
**Changes:** Added Sentry breadcrumbs and error capture

```diff
+ import { addBreadcrumb, captureException } from '../config/sentry';

  // Request interceptor
  this.client.interceptors.request.use(
    async (config) => {
+     addBreadcrumb(`API ${config.method?.toUpperCase()} ${config.url}`, 'http', ...);
      ...
    }
  );

  // Response interceptor
  this.client.interceptors.response.use(
    (response) => response,
    async (error) => {
+     if (error.response?.status !== 401) {
+       captureException(error, { endpoint, method, status, statusText });
+     }
      ...
    }
  );
```

**Review Focus:**
- Verify 401 errors are NOT captured (expected auth flow)
- Check breadcrumb data doesn't include sensitive info (headers, body)
- Confirm captureException context is useful for debugging

---

### 13. `src/store/useStore.ts`
**Changes:** Added Sentry breadcrumbs to key actions

```diff
+ import { addBreadcrumb, captureException } from '../config/sentry';

  login: async (deviceUuid, deviceKey) => {
+   addBreadcrumb('Login attempt', 'auth');
    ...
  },

  fetchOrders: async () => {
+   addBreadcrumb('Fetching orders', 'store');
    ...
  },

  updateOrderStatus: async (orderId, status) => {
+   addBreadcrumb('Updating order status', 'store', { orderId, newStatus: status });
    ...
  },
```

**Review Focus:**
- Verify orderId in breadcrumb doesn't constitute PII
- Check breadcrumbs don't log sensitive customer data

---

## Configuration Files Modified

### 14. `android/app/build.gradle`
**Changes:** Version bump

```diff
- versionCode 6
- versionName "1.3.2"
+ versionCode 7
+ versionName "1.4.0"
```

---

### 15. `android/local.properties` (Created)
**Changes:** SDK location for local builds

```properties
sdk.dir=/Users/brianlapp/Library/Android/sdk
```

**Note:** This file should NOT be committed - it's machine-specific.

---

## Potential Issues to Investigate

### 1. Circular Import Risk
- `App.tsx` imports from `src/config/sentry.ts`
- `src/config/sentry.ts` imports `@sentry/react-native`
- `src/store/useStore.ts` imports from `src/config/sentry.ts`
- **Risk:** Potential circular dependency if Sentry imports trigger store access

### 2. Heartbeat Dependency Array
- `useHeartbeat` now depends on `orders.orders`
- **Risk:** If orders change frequently, heartbeat callback recreates
- **Mitigation:** Heartbeat only runs every 60s, callback recreation is cheap

### 3. Sentry DSN Not Configured
- Current value: `'YOUR_SENTRY_DSN_HERE'`
- **Risk:** Sentry silently disabled in production
- **Action Required:** User must provide real DSN before release

### 4. printer_status Value Change
- Changed from `'online'/'offline'` to `'connected'/'disconnected'`
- **Risk:** Backend may expect old values
- **Action Required:** Verify backend handles both or update backend

### 5. OTA Update Auto-Reload
- App auto-reloads when update is available
- **Risk:** Could interrupt active order processing
- **Mitigation:** Only checks on app start and foreground transition

---

## Pre-Existing TypeScript Errors (NOT introduced by this change)

These errors existed before this implementation and should be addressed separately:

```
src/api/client.ts(358,11): error TS2741: Property 'has_more' is missing
src/api/supabaseClient.ts(292,11): error TS2561: 'hasMore' does not exist
src/components/OrderCard.tsx(11,7): error TS2739: missing 'out_for_delivery', 'delivered'
src/screens/OrdersListScreen.tsx(343,20): error TS2448: 'performPrint' used before declaration
src/services/heartbeatService.ts(4,30): error TS2307: Cannot find module 'expo-application'
```

---

## Testing Checklist for Auditor

### OTA Updates
- [ ] App starts without crashes in production mode
- [ ] `__DEV__` check prevents update checks in development
- [ ] Update check logs appear on app start
- [ ] App doesn't crash if update server unreachable

### Sentry
- [ ] Sentry initializes without errors (check console)
- [ ] Error boundary catches intentional test error
- [ ] Breadcrumbs appear for login/fetch/status update
- [ ] No PII in Sentry events (check restaurant context)

### Stuck Orders
- [ ] Heartbeat payload includes stuck_orders when threshold exceeded
- [ ] Orders in terminal states (completed, cancelled) NOT flagged
- [ ] Empty stuck_orders sent as `undefined`, not `[]`

### Regression
- [ ] Existing order flow works (fetch, acknowledge, status update)
- [ ] Printer functionality not affected
- [ ] Login/logout works correctly
- [ ] Offline queue still functions

---

## Questions for User Before Release

1. **Sentry DSN:** Please provide your Sentry project DSN to enable error tracking
2. **Backend API:** Does the backend expect `stuck_orders` in heartbeat? If not, we should coordinate deployment
3. **printer_status:** Verify backend accepts `'connected'/'disconnected'` (was `'online'/'offline'`)

---

## Rollback Plan

If issues are found:
1. Revert to commit before these changes
2. Run `npx expo prebuild --clean` to regenerate native code
3. Build and deploy previous version

---

*End of Audit Handoff Document*
