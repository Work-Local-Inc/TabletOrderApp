TabletOrderApp – handoff snapshot (for next agent)

Repo path: /Users/brianlapp/Documents/GitHub/TabletOrderApp
Backend target: Replit REST API (Bearer auth) at https://39d6a4b9-a0f2-4544-a607-a9203b1fa6a8-00-1qkpr2vwm16p5.riker.replit.dev/api/tablet

What changed (already in repo)
- Store now uses REST client (`src/store/useStore.ts` imports `apiClient`), so Supabase direct access is disabled.
- Login screen now pulls stored creds via REST client, not Supabase (`src/screens/LoginScreen.tsx`).
- Supabase client and service key deprecated with warnings (`src/lib/supabase.ts`, `src/api/supabaseClient.ts`), service key string replaced with placeholder.
- REST client hardened: response transforms, debug logging, token refresh path (`src/api/client.ts`).
- `src/api/index.ts` exports REST client and marks Supabase usage as deprecated.

Current behavior (expected)
- Auth: POST /api/tablet/auth/login with device UUID/key, stores session token/restaurant info in AsyncStorage.
- Polling: `useStore.fetchOrders` calls GET /api/tablet/orders every 5s when screen focused; merges by id.
- Status updates: PATCH /api/tablet/orders/:id/status for acknowledge/updates; queue offline actions.
- Heartbeat: POST /api/tablet/heartbeat via `useHeartbeat` (1m interval).
- UI: Orders list/detail flows use REST-shaped data (items use `price/notes`; totals at root).

Gaps / risks
- Hardcoded test creds remain in `src/screens/LoginScreen.tsx` (TODO comment). Remove or gate with __DEV__.
- Supabase service-role key was previously shipped; placeholder now. Must revoke old key in Supabase dashboard (Settings → API → Regenerate service role key).
- No QR scanner implementation; button shows placeholder alert.
- Sound notification depends on `expo-av` and `assets/notification.mp3` which are not present; code falls back to vibration only.
- Auto-print plumbing exists (`services/printService.ts`) but no ESC/POS bridge/library installed.
- No backend toggle env; BASE_URL is hard-coded in `src/api/client.ts`.

Sanity checklist for next agent
1) Revoke Supabase service-role key in dashboard (critical security cleanup).
2) Run quick smoke with Expo Go:
   - cd /Users/brianlapp/Documents/GitHub/TabletOrderApp
   - npx expo start
   - Scan QR; login with provided UUID/key; confirm orders list populates and status updates succeed.
3) If Gradle build needed: rm -rf android && npx expo prebuild && cd android && ./gradlew assembleDebug (or use EAS).
4) Decide on BASE_URL handling (env per build) and remove hardcoded test creds.
5) Implement remaining features: QR scan (camera), sound with packaged asset, ESC/POS printer bridge.

Key files to read
- REST client: src/api/client.ts
- Store (polling/state/queue): src/store/useStore.ts
- Login: src/screens/LoginScreen.tsx
- Deprecated Supabase stubs: src/lib/supabase.ts, src/api/supabaseClient.ts
