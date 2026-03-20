# Maestro E2E Test Suite — KDS User Stories

> **For Claude:** Read CLAUDE.md and all memory files FIRST. Connect tablet via ADB before running tests. Use `adb devices` to verify.

**Goal:** Comprehensive Maestro test suite covering all restaurant KDS workflows. Run overnight on physical tablet to validate before rollout to 200 locations.

**Prerequisites:**
- Maestro CLI installed (`brew install maestro`)
- Samsung tablet connected via USB with USB Debugging enabled
- App installed and paired to test restaurant (JJ's Shawarma, restaurant_id: 1021)
- Test orders available in the system (create via admin dashboard if needed)

---

## Test 1: App Launch & Order Loading

**File:** `.maestro/01_app_launch.yaml`

**Story:** Restaurant opens for the day, KDS tablet powers on, orders load automatically.

**Steps:**
- Launch `ca.menu.orders`
- Verify dark mode (dark background visible)
- Verify orders load within 10 seconds
- Verify 3-column Kanban visible (New / Active / Complete headers)
- Verify footer shows: restaurant logo, restaurant name, status dot, gear icon
- Screenshot: `screenshots/01_app_launch.png`

---

## Test 2: Accept New Order

**File:** `.maestro/02_accept_order.yaml`

**Story:** New order comes in, kitchen staff taps Accept to acknowledge.

**Steps:**
- Find an order card in the "New" column
- Tap the Accept button on the card
- Verify order moves to "Active" column (no bounce back)
- Verify no error alerts appear
- Wait 3 seconds, verify order stays in Active
- Screenshot: `screenshots/02_accept_order.png`

---

## Test 3: Forward Status Flow (Tap)

**File:** `.maestro/03_forward_tap.yaml`

**Story:** Kitchen prepares order, marks it ready, then complete — via button taps.

**Steps:**
- Find an order in "Active" column
- Tap to expand the card
- Tap the status advance button (should move toward Complete)
- Verify order moves to next status
- Verify no HTTP 400 errors in logs
- Screenshot: `screenshots/03_forward_tap.png`

---

## Test 4: Forward Status Flow (Drag)

**File:** `.maestro/04_forward_drag.yaml`

**Story:** Kitchen drags order card from Active to Complete column.

**Steps:**
- Find an order in "Active" column
- Swipe/drag the card to the right
- Verify order moves to "Complete" column
- Verify vibration feedback occurred (check logs)
- Screenshot: `screenshots/04_forward_drag.png`

---

## Test 5: Backward Status Flow (Drag)

**File:** `.maestro/05_backward_drag.yaml`

**Story:** Mistake was made — kitchen drags order back from Complete to Active.

**Steps:**
- Find an order in "Complete" column
- Swipe/drag the card to the left
- Verify order moves back to "Active" column
- Verify `force: true` was sent in API call (check logs)
- Verify no HTTP 400 errors
- Screenshot: `screenshots/05_backward_drag.png`

---

## Test 6: Expand & Collapse Cards

**File:** `.maestro/06_expand_collapse.yaml`

**Story:** Kitchen staff taps order to see details, then taps again to collapse.

**Steps:**
- Tap on a collapsed order card
- Verify expanded view shows: customer name, order items, modifiers, totals
- Verify order details section is visible
- Tap the card header again
- Verify card collapses back to compact view
- Screenshot: `screenshots/06_expanded.png` and `screenshots/06_collapsed.png`

---

## Test 7: Settings Screen

**File:** `.maestro/07_settings.yaml`

**Story:** Manager opens settings to adjust preferences.

**Steps:**
- Tap gear icon in footer
- Verify Settings screen opens
- Verify toggles visible: Dark Mode, Auto-Print, Show Prices
- Verify Dark Mode is ON by default
- Navigate back to orders screen
- Verify orders still displayed correctly
- Screenshot: `screenshots/07_settings.png`

---

## Test 8: Footer Verification

**File:** `.maestro/08_footer.yaml`

**Story:** Verify all footer elements render correctly.

**Steps:**
- Verify restaurant logo is visible (not blank/empty)
- Verify restaurant name displays next to logo
- Verify status dot is visible (green, amber, or red)
- Verify gear icon is tappable
- Verify refresh button (↻) is somewhere accessible
- Screenshot: `screenshots/08_footer.png`

---

## Test 9: Column Header Consistency

**File:** `.maestro/09_column_headers.yaml`

**Story:** All three column headers should be visually consistent.

**Steps:**
- Screenshot the full Kanban board
- Verify "New", "Active", "Complete" headers are all visible
- Verify count badges show next to each header
- Verify all headers appear at the same height
- Screenshot: `screenshots/09_headers.png`

---

## Test 10: KDS Kiosk Mode

**File:** `.maestro/10_kiosk_mode.yaml`

**Story:** Tablet runs in kiosk mode — no system bars, max brightness, can't exit.

**Steps:**
- Verify Android status bar is NOT visible at top
- Verify Android navigation bar is NOT visible at bottom
- Press Android back button — verify app does NOT exit
- Verify screen stays on (useKeepAwake)
- Screenshot: `screenshots/10_kiosk.png`

---

## Running the Tests

```bash
# Run all tests
maestro test .maestro/

# Run a single test
maestro test .maestro/02_accept_order.yaml

# Run with verbose output
maestro test --debug-output .maestro/

# Pull logs after test
adb logcat -d | grep "ReactNativeJS" | grep -iE "error|status|API|====|400" > test_logs.txt
```

## Test Data Setup

Before running tests, ensure test restaurant has orders in various states:
- At least 2 orders in `pending` (New column)
- At least 2 orders in `confirmed` or `preparing` (Active column)
- At least 2 orders in `ready` or `completed` (Complete column)

Create test orders via admin dashboard or API if needed.

## Success Criteria

- All 10 tests pass without errors
- No HTTP 400/500 errors in logs
- No app crashes
- Screenshots show correct UI state at each step
- Forward AND backward status transitions work
- Footer displays logo correctly
