# HANDOFF: Kanban Swipe/Drag Broken on Android Tablet

**Date:** 2026-02-11  
**Priority:** CRITICAL — Live in kitchens, blocking core UX  
**Status:** Partially fixed, needs completion  

---

## The Problem

Cards in the Kanban board cannot be swiped left/right to change order status when the column has enough orders to make the parent ScrollView scrollable. This is the primary interaction for kitchen staff.

## Root Cause (CONFIRMED via live testing)

**Android's native ScrollView steals touch events from React Native's JS-level PanResponder.** When a column has enough cards to require vertical scrolling, the native ScrollView grabs the touch at the native level BEFORE the JS PanResponder can process horizontal drags.

### Proof

We moved 6 of 8 orders out of the "New" column (leaving only 2 — not enough to scroll). Swipe instantly worked. Moved them back → swipe broke again. This was tested on the live production tablet.

## What Has Been Tried (and results)

### Attempt 1: `onStartShouldSetPanResponder: false` + `onMoveShouldSetPanResponderCapture`
- **Theory:** Don't claim touch on start, let ScrollView handle initially, reclaim via capture phase when horizontal movement detected
- **Result:** FAILED — On Android, native ScrollView grabs touches at the native level before JS capture handlers fire. The PanResponder never gets a chance.

### Attempt 2: `onStartShouldSetPanResponder: true` + smart `onPanResponderTerminationRequest`  
- **Theory:** Claim touch first, then default to keeping it (only give up when vertical movement clearly dominates: `dy > 10 && dy > 1.5 * dx`)
- **Result:** PARTIAL — Taps worked (via `onTouchEnd`), but swipe still didn't register. The native ScrollView still intercepts move events even when PanResponder claims the touch.

### Attempt 3: Scroll lock via `onTouchStart`/`onTouchEnd` callbacks
- **Theory:** Physically disable ScrollView (`scrollEnabled={false}`) the instant a card is touched. Re-enable on touch end. No ScrollView = no conflict.
- **Result:** DEPLOYED, AWAITING TEST. This is currently live but hasn't been confirmed working yet.

## Current Code State

### Files Modified (from original working state)

#### `src/components/orders/ExpandableOrderCard.tsx`
- **Props added:** `onScrollLock?: () => void` and `onScrollUnlock?: () => void`
- **PanResponder:** `onStartShouldSetPanResponder: true`, smart termination logic, `onMoveShouldSetPanResponderCapture` with `dx > dy` gating
- **Collapsed card:** `onTouchStart` calls `onScrollLock?.()` + records start time. `onTouchEnd` calls `onScrollUnlock?.()` + tap detection (duration < 300ms)
- **`onPanResponderRelease` and `onPanResponderTerminate`:** Also call `onScrollUnlock?.()` as safety nets
- **Threshold:** `Math.min(containerWidth * 0.25, 80)` — capped at 80px (was 128px on 2-col board)
- **Stale closure issue:** PanResponder is in `useRef()` — captures `containerWidth`, `onDragEnd`, `onTap`, `onScrollLock`, `onScrollUnlock` at first render. These go stale if props change. NOT YET FIXED.

#### `src/components/orders/KanbanBoard4Col.tsx`
- **Added:** `useState` import, `draggingColumn` state, `touchedColumn` state
- **Added:** `handleDragStart`/`handleDragRelease` callbacks
- **ScrollView:** `scrollEnabled={draggingColumn !== config.key && touchedColumn !== config.key}`
- **ExpandableOrderCard:** Now receives `onDragStart`, `onDragRelease`, `onScrollLock`, `onScrollUnlock` props

#### `src/components/orders/KanbanBoard.tsx` (2-col simplified view)
- **Added:** `touchedColumn` state
- **ScrollView:** `scrollEnabled={draggingColumn !== 'new' && touchedColumn !== 'new'}` (and same for 'complete')
- **ExpandableOrderCard:** Now receives `onScrollLock`, `onScrollUnlock` props

## Known Remaining Issues

1. **Stale PanResponder closure:** `useRef()` captures callbacks at first render. If `onScrollLock`/`onScrollUnlock` change (they're inline arrow functions → new ref each render), the PanResponder has stale versions. The `onTouchStart`/`onTouchEnd` handlers are NOT inside the PanResponder, so they should be fine. But `onDragEnd`, `onTap`, `containerWidth` inside the PanResponder are still stale.

2. **State update timing:** `onTouchStart` → `setTouchedColumn(...)` → React batches the state update → ScrollView re-renders with `scrollEnabled={false}`. There may be a race if the native ScrollView grabs the touch BEFORE the state update flushes (within ~16ms). If this is the issue, a workaround is to use a ref + `forceUpdate`, or to add `react-native-gesture-handler`.

3. **Scrolling UX tradeoff:** With scroll disabled on card touch, users can't scroll by dragging on a card. They must scroll via empty space, column header, or drag hint footer. If the column is packed with cards, scrolling may be difficult.

## Architecture

```
OrdersListScreen.tsx
├── KanbanBoard.tsx (simplifiedView=true, 2 columns)
│   ├── ScrollView (New column) ← scrollEnabled controlled
│   │   └── ExpandableOrderCard[] ← PanResponder + onTouchStart/End
│   └── ScrollView (Complete column) ← scrollEnabled controlled
│       └── ExpandableOrderCard[]
│
├── KanbanBoard4Col.tsx (simplifiedView=false, 4 columns)
│   ├── ScrollView (New) ← scrollEnabled controlled
│   │   └── ExpandableOrderCard[]
│   ├── ScrollView (Active)
│   │   └── ExpandableOrderCard[]
│   ├── ScrollView (Ready)
│   │   └── ExpandableOrderCard[]
│   └── ScrollView (Complete)
│       └── ExpandableOrderCard[]
```

## Status Flow
```
pending → confirmed → preparing → ready → completed
  (New)    (Active)    (Active)  (Ready)  (Complete)
```

## Key Callbacks
- `handleKanbanStatusChange(orderId, targetStatus)` in `OrdersListScreen.tsx` — optimistic update + Supabase RPC
- `tabletUpdateOrderStatus(numericId, targetStatus)` in `src/api/supabaseRpc.ts` — direct DB call

## The Nuclear Option (if scroll lock doesn't work)

Install `react-native-gesture-handler` which handles gestures at the NATIVE level on Android. This requires a **full native rebuild** (can't OTA). Use `Gesture.Pan()` with `blocksExternalGesture(scrollGesture)` pattern from RNGH docs. This is the industry-standard solution for this exact problem.

```bash
npx expo install react-native-gesture-handler
# Then full rebuild via EAS
eas build --platform android --profile production
```

## Test Orders in Supabase

Restaurant: **JJ's Shawarma** (restaurant_id = 1021 in `menuca_v3` schema)  
Currently 8 pending orders in the New column.

```sql
-- Check current orders
SELECT id, order_number, order_status, customer_name
FROM menuca_v3.orders
WHERE restaurant_id = 1021
AND order_status = 'pending';

-- Move orders to test (reduce New column count)
UPDATE menuca_v3.orders 
SET order_status = 'confirmed', updated_at = NOW()
WHERE restaurant_id = 1021
AND id IN (168, 167, 156, 145, 143, 132)
AND order_status = 'pending';

-- Revert back
UPDATE menuca_v3.orders 
SET order_status = 'pending', updated_at = NOW()
WHERE restaurant_id = 1021
AND id IN (168, 167, 156, 145, 143, 132);
```

## Git State

All changes are committed on `main`. Latest commit: `c4c615e`. Three OTA updates have been pushed, the latest being the scroll lock approach.

```bash
eas update:list --branch production --limit 5 --non-interactive
```
