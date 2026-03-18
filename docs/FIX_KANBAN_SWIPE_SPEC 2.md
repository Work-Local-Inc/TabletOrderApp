# Fix: Kanban Swipe/Drag Broken When Column Has Scrollable Content

**Date:** 2026-02-11  
**Status:** IMPLEMENTED  
**Severity:** High (core UX broken)  
**Verified:** Root cause confirmed via live DB test on tablet

---

## Root Cause

When a Kanban column has enough orders to require vertical scrolling, the parent `ScrollView` steals touch events from the card's `PanResponder` before a horizontal drag can be established.

### The Race Condition (step by step)

1. User touches a collapsed card
2. `onStartShouldSetPanResponder: () => true` — PanResponder claims the touch **immediately**
3. `onPanResponderGrant` fires — sets `isDragging = false`
4. User begins horizontal finger movement
5. ScrollView requests the touch via `onPanResponderTerminationRequest`
6. Since `isDragging` is still `false` (requires 15px horizontal movement), PanResponder **surrenders** (returns `true`)
7. ScrollView takes over — **drag is killed**

### Why Only Some Columns Are Affected

- Columns with **many orders** (content overflows) → ScrollView is scrollable → actively fights for touches → **drag broken**
- Columns with **few orders** (content fits) → ScrollView has nothing to scroll → doesn't request touches → **drag works**

### Observed Symptoms

| Board | Column | Drag works? | Why |
|-------|--------|-------------|-----|
| 4-col | New (8 orders) | NO | ScrollView scrollable, steals touch |
| 4-col | Active (few) | YES | ScrollView not scrollable |
| 4-col | Ready (few) | YES | ScrollView not scrollable |
| 4-col | Complete (few) | YES | ScrollView not scrollable |
| 2-col | New (many) | NO | ScrollView scrollable, steals touch |
| 2-col | Complete (many) | NO | ScrollView scrollable, steals touch |

Confirmed by moving 6/8 orders out of New → drag started working with only 2 orders.

---

## Implementation Plan

### Change 1: Fix PanResponder Touch Strategy (CRITICAL)

**File:** `src/components/orders/ExpandableOrderCard.tsx`  
**Lines:** 264–342 (PanResponder definition)

**Problem:** `onStartShouldSetPanResponder: () => true` claims all touches immediately, then loses them to ScrollView.

**Strategy change:** Don't claim on touch start. Let ScrollView handle initially. PanResponder takes over only when horizontal movement is detected via `onMoveShouldSetPanResponder`.

#### Exact changes:

**Line 267** — Change:
```typescript
// BEFORE
onStartShouldSetPanResponder: () => true,
```
```typescript
// AFTER  
onStartShouldSetPanResponder: () => false,
```

**Lines 268-270** — Change:
```typescript
// BEFORE
onMoveShouldSetPanResponder: (_, gestureState) => {
  return Math.abs(gestureState.dx) > 10;
},
```
```typescript
// AFTER
onMoveShouldSetPanResponder: (_, gestureState) => {
  // Only claim when horizontal movement dominates vertical (prevents hijacking scroll)
  return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
},
```

**NEW — Add capture phase handler** (after onMoveShouldSetPanResponder):
```typescript
// Capture phase: intercept horizontal moves before ScrollView can claim them
onMoveShouldSetPanResponderCapture: (_, gestureState) => {
  return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
},
```

**onPanResponderTerminationRequest** — Strengthen to also refuse when horizontal movement already dominates, even before isDragging threshold:
```typescript
// BEFORE
onPanResponderTerminationRequest: (_, gestureState) => {
  if (isDragging.current) return false;
  return true;
},
```
```typescript
// AFTER
onPanResponderTerminationRequest: (_, gestureState) => {
  if (isDragging.current) return false;
  // Also refuse if horizontal movement already dominates (before isDragging threshold)
  if (Math.abs(gestureState.dx) > 5 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy)) return false;
  return true;
},
```

**Old tap detection block in onPanResponderRelease** — Removed (taps now handled by onTouchEnd, see Change 4).

### Change 2: Add Drag State Tracking to KanbanBoard4Col (MISSING)

**File:** `src/components/orders/KanbanBoard4Col.tsx`

**Problem:** Unlike `KanbanBoard.tsx` (2-col), the 4-col board does NOT pass `onDragStart` or `onDragRelease` to `ExpandableOrderCard`. It also has no `draggingColumn` state or scroll-disable logic.

#### Exact changes:

**Line 1** — Add `useState` to import:
```typescript
// BEFORE
import React, { useCallback } from 'react';
// AFTER
import React, { useCallback, useState } from 'react';
```

**After line 49** — Add drag state and handlers:
```typescript
// Track which column has an active drag so we can disable scroll
const [draggingColumn, setDraggingColumn] = useState<ColumnType | null>(null);

const handleDragStart = useCallback((fromColumn: ColumnType) => {
  setDraggingColumn(fromColumn);
}, []);

const handleDragRelease = useCallback(() => {
  setDraggingColumn(null);
}, []);
```

**Lines 194-206** — Add missing props to `ExpandableOrderCard`:
```typescript
// BEFORE
<ExpandableOrderCard
  key={order.id}
  order={order}
  column={config.key === 'complete' ? 'complete' : 'new'}
  isExpanded={selectedOrderId === order.id}
  containerWidth={columnWidth}
  onDragEnd={(orderId, translationX) =>
    handleDragEnd(orderId, translationX, config.key)
  }
  onTap={handleOrderTap}
  onStatusChange={() => handleStatusButtonPress(order.id, config.key)}
/>
```
```typescript
// AFTER
<ExpandableOrderCard
  key={order.id}
  order={order}
  column={config.key === 'complete' ? 'complete' : 'new'}
  isExpanded={selectedOrderId === order.id}
  containerWidth={columnWidth}
  onDragEnd={(orderId, translationX) =>
    handleDragEnd(orderId, translationX, config.key)
  }
  onDragStart={() => handleDragStart(config.key)}
  onDragRelease={handleDragRelease}
  onTap={handleOrderTap}
  onStatusChange={() => handleStatusButtonPress(order.id, config.key)}
/>
```

**Line 181-185** — Add `scrollEnabled` to ScrollView:
```typescript
// BEFORE
<ScrollView
  style={styles.scrollView}
  contentContainerStyle={styles.scrollContent}
  showsVerticalScrollIndicator={false}
  scrollEventThrottle={16}
>
```
```typescript
// AFTER
<ScrollView
  style={styles.scrollView}
  contentContainerStyle={styles.scrollContent}
  showsVerticalScrollIndicator={false}
  scrollEventThrottle={16}
  scrollEnabled={draggingColumn !== config.key}
>
```

### Change 3: Add scrollEnabled to KanbanBoard (2-col)

**File:** `src/components/orders/KanbanBoard.tsx`

**Problem:** The 2-col board already tracks `draggingColumn` state (line 53) and has `handleDragStart`/`handleDragRelease` (lines 55-61), but NEVER uses this state to disable scrolling.

#### Exact changes:

**Lines 128-132** (New column ScrollView) — Add `scrollEnabled`:
```typescript
// BEFORE
<ScrollView
  style={styles.scrollView}
  contentContainerStyle={styles.scrollContent}
  showsVerticalScrollIndicator={false}
  scrollEventThrottle={16}
>
```
```typescript
// AFTER
<ScrollView
  style={styles.scrollView}
  contentContainerStyle={styles.scrollContent}
  showsVerticalScrollIndicator={false}
  scrollEventThrottle={16}
  scrollEnabled={draggingColumn !== 'new'}
>
```

**Lines 182-186** (Complete column ScrollView) — Add `scrollEnabled`:
```typescript
// BEFORE
<ScrollView
  style={styles.scrollView}
  contentContainerStyle={styles.scrollContent}
  showsVerticalScrollIndicator={false}
  scrollEventThrottle={16}
>
```
```typescript
// AFTER
<ScrollView
  style={styles.scrollView}
  contentContainerStyle={styles.scrollContent}
  showsVerticalScrollIndicator={false}
  scrollEventThrottle={16}
  scrollEnabled={draggingColumn !== 'complete'}
>
```

### Change 4: Add Tap Handler to Collapsed Card (REVISED)

**File:** `src/components/orders/ExpandableOrderCard.tsx`

**Problem:** With `onStartShouldSetPanResponder: () => false`, simple taps (no movement) will no longer trigger `onPanResponderRelease`. We need an explicit tap handler on the collapsed card.

**Why NOT TouchableOpacity/Pressable wrapper:** Wrapping in TouchableOpacity would claim the responder on touch start, which can prevent the PanResponder from ever seeing moves — re-introducing the same bug.

**Chosen approach:** Use native `onTouchStart`/`onTouchEnd` on the same `Animated.View` element that has the panHandlers. These events fire regardless of responder state and don't interfere with the responder system.

#### Exact changes:

**Collapsed card Animated.View** — Add onTouchStart/onTouchEnd directly:
```typescript
// AFTER
<Animated.View
  renderToHardwareTextureAndroid
  style={[styles.card, { ... }]}
  onTouchStart={() => {
    startTime.current = Date.now();
  }}
  onTouchEnd={() => {
    const duration = Date.now() - startTime.current;
    if (!isDragging.current && duration < 300) {
      onTap(order.id);
    }
  }}
  {...panResponder.panHandlers}
>
```

**Old tap detection block in onPanResponderRelease** — Removed (taps now handled by onTouchEnd).

---

## Stale Closure (Secondary Issue — NOT fixing now)

The `PanResponder` is created inside `useRef()` which captures `onDragEnd`, `onTap`, `containerWidth`, etc. at **first render**. If props change, the PanResponder uses stale values. 

**Why we're NOT fixing this now:**
- The stale closure has been present since the feature was built
- The primary callbacks (`handleDragEnd`, `handleKanbanStatusChange`) are stable `useCallback`s
- `containerWidth` only changes on orientation/dimension change (rare on a fixed tablet)
- Fixing requires converting to `useMemo` with dependencies or using callback refs — higher risk of regression

**Future fix:** Convert PanResponder from `useRef` to `useMemo` with proper dependency array, or use refs for all callbacks.

---

## Testing Plan

### Pre-test setup
1. Revert the 6 test orders back to `pending` status in Supabase
2. Ensure 8+ orders are in the New column (scrollable content)

### Test cases

| # | Test | Board | Expected |
|---|------|-------|----------|
| 1 | Swipe right from New (8+ orders) | 4-col | Card moves to Active ✓ |
| 2 | Swipe right from Active | 4-col | Card moves to Ready ✓ |
| 3 | Swipe left from Complete | 4-col | Card moves to Ready ✓ |
| 4 | Swipe left from Active | 4-col | Card moves to New ✓ |
| 5 | Vertical scroll in New (8+ orders) | 4-col | Scrolls normally, no drag triggered ✓ |
| 6 | Tap collapsed card | 4-col | Card expands ✓ |
| 7 | Tap expanded card | 4-col | Card collapses ✓ |
| 8 | Swipe right from New | 2-col | Card moves to Complete ✓ |
| 9 | Swipe left from Complete | 2-col | Card moves to New ✓ |
| 10 | Vertical scroll in both columns | 2-col | Scrolls normally ✓ |
| 11 | Diagonal gesture (45°) | Both | Neither scroll nor drag triggers (clean rejection) |
| 12 | Short flick (< 25% width) | Both | Card snaps back, no status change |

### Regression checks
- Expanded card action buttons still work
- Phone number tap still works
- Print button still works
- Driver dispatch still works
- Status change button (in expanded card) still works

---

## Files Modified

| File | Changes |
|------|---------|
| `src/components/orders/ExpandableOrderCard.tsx` | Fix PanResponder strategy + add tap wrapper |
| `src/components/orders/KanbanBoard4Col.tsx` | Add drag state, onDragStart/onDragRelease, scrollEnabled |
| `src/components/orders/KanbanBoard.tsx` | Add scrollEnabled to both ScrollViews |

**Estimated diff:** ~40 lines changed across 3 files  
**Risk:** Low — changes are isolated to gesture handling, no business logic changes
