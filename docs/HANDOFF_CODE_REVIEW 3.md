# Code Review Handoff - Tablet Order App

## Overview
This React Native/Expo tablet app is used by restaurants to manage incoming orders. A major refactor was just completed converting the UI from a list-based view to a Kanban-style drag-and-drop interface.

## Recent Changes (This Session)
The following files were significantly modified or created:

### New Files
- `src/components/orders/ExpandableOrderCard.tsx` - Main card component for Kanban view
- `src/components/orders/KanbanBoard4Col.tsx` - 4-column Kanban layout for regular view

### Modified Files
- `src/components/orders/KanbanBoard.tsx` - 2-column Kanban for simplified view
- `src/screens/OrdersListScreen.tsx` - Main screen, now uses Kanban for both views
- `src/store/useStore.ts` - Zustand store, now uses Supabase RPC for status updates
- `src/api/supabaseRpc.ts` - Direct Supabase RPC calls (created in prior session)

## Areas to Audit

### 1. ExpandableOrderCard.tsx (Highest Priority)
This is a complex component with:
- PanResponder for drag-and-drop gestures
- Animated.View with transforms
- Nested TouchableOpacity elements
- Conditional rendering for compact (4-col) vs full (2-col) layouts
- Driver dispatch integration
- z-index management for proper layering

**Potential Issues:**
- Nested TouchableOpacity touch conflicts
- Memory leaks from useRef/Animated values
- PanResponder not properly cleaned up
- Conditional rendering edge cases

### 2. Status Update Flow
Status updates now bypass the PHP backend and go directly to Supabase:
- `src/store/useStore.ts` - `updateOrderStatus` function
- `src/api/supabaseRpc.ts` - `tabletUpdateOrderStatus` function

**Potential Issues:**
- Data consistency between Supabase and PHP backend
- Error handling and rollback on failure
- Optimistic updates that may get out of sync

### 3. KanbanBoard4Col.tsx
New 4-column layout with:
- Column configuration array
- Drag handling across 4 columns
- Status mapping between columns and actual statuses

**Potential Issues:**
- Status mapping correctness (new→pending, active→confirmed/preparing, etc.)
- Edge cases when dragging between non-adjacent columns

### 4. OrdersListScreen.tsx
Major refactor removing FlatList-based UI:
- Auto-select feature disabled
- Both views now use Kanban components
- OrderDetailPanel overlay removed

**Potential Issues:**
- Unused imports/dead code from old implementation
- Memory management with order lists
- Polling/refresh logic still working correctly

## Tech Stack
- React Native / Expo SDK 52
- TypeScript
- Zustand (state management)
- Supabase (database)
- PHP backend (menu.ca API) - partially bypassed for status updates

## Build Commands
```bash
# Install dependencies
npm install

# Start dev server
npx expo start --clear

# Type check
npx tsc --noEmit
```

## Known TypeScript Errors (Pre-existing)
Running `npx tsc --noEmit` shows several pre-existing type errors unrelated to this session's changes. These should be addressed but are not blockers.

## Testing Checklist
1. Both views render correctly (toggle via settings)
2. Cards expand/collapse on tap
3. Cards drag horizontally to change status
4. Expanded cards are draggable
5. Driver dispatch shows for delivery orders with dispatch enabled
6. Status updates persist after refresh
7. No console errors during normal operation

## Database Tables Referenced
- `menuca_v3.orders` - Order data
- `menuca_v3.delivery_and_pickup_configs` - Restaurant delivery settings
- `menuca_v3.delivery_providers` - Available delivery providers
- `menuca_v3.tablet_update_order_status` - RPC function for status updates

## Preliminary Audit Findings (Updated)

Applied fixes and remaining items:

### Fixed
1. **Print flow function ordering** (`OrdersListScreen.tsx`)
   - `performPrint` now defined before `handlePrint`
   - Prevents runtime crash on render

2. **Rollback on failed status update** (`useStore.ts`)
   - Optimistic update now reverts on Supabase RPC failure
   - Prevents UI/backend drift

3. **Offline queue status updates** (`useStore.ts`)
   - Queue processing now uses `tabletUpdateOrderStatus` (Supabase RPC)
   - Keeps transitions consistent with online flow

4. **Dead imports removed** (`OrdersListScreen.tsx`)
   - Removed `OrderListItem`, `OrderDetailPanel`, `OrderFilters`, and `FlatList`

### Warnings (Still Pending)
- Nested TouchableOpacity touch conflicts in ExpandableOrderCard
- PanResponder cleanup behavior (verify unmount behavior under heavy usage)
- Alert import inside async function in useStore (testing difficulty)

### False Positive (Verified Correct)
- "Incorrect backward status mapping" in KanbanBoard4Col - **Code is correct**, audit misread destination vs source column logic

## Contact
This handoff was created for a code review audit before Play Store deployment.
