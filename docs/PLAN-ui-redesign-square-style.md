# 🎨 UI Redesign - Square-Style Order Management

**Created:** Nov 28, 2025  
**Status:** IN PROGRESS  
**Goal:** Transform the app into a clean, professional order management interface inspired by Square

---

## The Vision

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🍕 Kitchen Printer          [🍳 Kitchen] [🧾 Receipt] [📋 Both]      ⚙️   │
│  🟢 Printer Connected                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                              │                                               │
│  ┌─────────────────────────┐ │  ┌─────────────────────────────────────────┐ │
│  │ ORDERS            🔄    │ │  │                                         │ │
│  ├─────────────────────────┤ │  │  Alex Smith                             │ │
│  │                         │ │  │  ─────────────────────────────────────  │ │
│  │ ● Alex Smith      7:08a │ │  │  ● New    [Mark as...]                  │ │
│  │   Pickup • 1 item       │ │  │                                         │ │
│  │                    ───▶ │ │  │  ┌─────────────────────────────────┐    │ │
│  │                         │ │  │  │ Pickup Details                  │    │ │
│  │ ○ ORDER#01       7:05a │ │  │  │                                 │    │ │
│  │   Pickup • 2 items      │ │  │  │ Customer    Alex Smith          │    │ │
│  │                         │ │  │  │ Phone       555-123-4567        │    │ │
│  │ ○ John Doe       6:45a │ │  │  │ Created     Jan 2, 7:08 AM      │    │ │
│  │   Delivery • 3 items    │ │  │  │ Pickup      Today at 7:38 AM    │    │ │
│  │                         │ │  │  └─────────────────────────────────┘    │ │
│  │                         │ │  │                                         │ │
│  │                         │ │  │  Items (1)                              │ │
│  │                         │ │  │  ┌─────────────────────────────────┐    │ │
│  │                         │ │  │  │ Custom Branding Guidebook  x1   │    │ │
│  │                         │ │  │  │ Variation: Regular      $200.00 │    │ │
│  │                         │ │  │  └─────────────────────────────────┘    │ │
│  │                         │ │  │                                         │ │
│  │                         │ │  │  ─────────────────────────────────────  │ │
│  │                         │ │  │  Subtotal                     $200.00   │ │
│  │                         │ │  │  Tax                           $26.00   │ │
│  │                         │ │  │  ═══════════════════════════════════   │ │
│  │                         │ │  │  TOTAL                        $226.00   │ │
│  │                         │ │  │                                         │ │
│  └─────────────────────────┘ │  │  ┌──────────┐ ┌──────────┐ ┌─────────┐  │ │
│                              │  │  │ 🍳 Print │ │ 🧾 Print │ │📋 Both │  │ │
│  ───────────────────────     │  │  │ Kitchen  │ │ Receipt  │ │        │  │ │
│  Filtered: All (5)           │  │  └──────────┘ └──────────┘ └─────────┘  │ │
│  [New] [In Progress] [Ready] │  │                                         │ │
│                              │  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Design Principles

1. **Clean & Professional** - Like Square, not cluttered
2. **Large Touch Targets** - Easy to tap on tablet
3. **Clear Visual Hierarchy** - Important info stands out
4. **Status at a Glance** - Color-coded order states
5. **Print-Focused** - Easy access to print actions

---

## Color Palette

| Element | Color | Hex |
|---------|-------|-----|
| Background | Dark Navy | `#1a1a2e` |
| Card Background | Slate | `#1e293b` |
| Header | Deep Blue | `#16213e` |
| New Order | Blue | `#3b82f6` |
| In Progress | Orange | `#f59e0b` |
| Ready | Green | `#22c55e` |
| Picked Up/Done | Gray | `#6b7280` |
| Text Primary | White | `#ffffff` |
| Text Secondary | Gray | `#94a3b8` |

---

## Tasks

- [ ] **Task 1:** Create new `OrderListItem` component
  - Compact order preview card
  - Shows: customer name, order type, item count, time
  - Status indicator dot
  - Selected state highlighting

- [ ] **Task 2:** Create `OrderDetailPanel` component
  - Full order details view
  - Customer info section
  - Items list with modifiers
  - Price breakdown
  - Print buttons (Kitchen / Receipt / Both)
  - Status change buttons

- [ ] **Task 3:** Create `StatusBadge` component
  - Color-coded status pills
  - New (blue), In Progress (orange), Ready (green), Done (gray)

- [ ] **Task 4:** Create `OrderFilters` component
  - Filter by status tabs
  - Count badges for each status

- [ ] **Task 5:** Redesign `OrdersListScreen` layout
  - Split view: list (1/3) + detail (2/3)
  - Responsive for tablet landscape
  - Empty states for no selection

- [ ] **Task 6:** Add status change functionality
  - "Mark as..." dropdown or buttons
  - Update order status via API
  - Optimistic UI updates

- [ ] **Task 7:** Polish & animations
  - Smooth transitions
  - Loading states
  - Pull to refresh

- [ ] **Task 8:** Archive this plan file

---

## Component Structure

```
src/
├── components/
│   ├── orders/
│   │   ├── OrderListItem.tsx      # Compact order card for list
│   │   ├── OrderDetailPanel.tsx   # Full order details
│   │   ├── OrderFilters.tsx       # Status filter tabs
│   │   ├── StatusBadge.tsx        # Status pill component
│   │   ├── ItemCard.tsx           # Individual item display
│   │   └── PrintButtons.tsx       # Print action buttons
│   └── common/
│       └── Card.tsx               # Reusable card wrapper
└── screens/
    └── OrdersListScreen.tsx       # Main screen (redesigned)
```

---

## Order Status Flow

```
   ┌─────────┐      ┌─────────────┐      ┌───────────┐      ┌───────────┐
   │   NEW   │ ───▶ │   ACTIVE    │ ───▶ │   READY   │ ───▶ │  PICKED   │
   │  (blue) │      │  (orange)   │      │  (green)  │      │   UP      │
   └─────────┘      └─────────────┘      └───────────┘      └───────────┘
        │                                                         │
        └─────────────────────────────────────────────────────────┘
                              (can mark done directly)
```

### Status Meanings:
- **New** = Just arrived, not yet acknowledged
- **Active** = Printed, on the board, being handled (flexible - could be queued or being made)
- **Ready** = Food is done, waiting for customer
- **Picked Up** = Customer got it, order complete

## Auto-Print Workflow (when enabled)

```
┌─────────────────────────────────────────────────────────────────┐
│  NEW ORDER ARRIVES                                              │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────┐                                           │
│  │ 🖨️ AUTO-PRINT   │ ← Kitchen ticket goes to printer          │
│  │   Kitchen Ticket │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                           │
│  │ 📋 AUTO-MOVE    │ ← Order moves to "Active"                 │
│  │   to Active     │   (ticket is on the board)                │
│  └─────────────────┘                                           │
│                                                                 │
│  Cook finishes → Staff taps [Ready] → Customer picks up → Done │
└─────────────────────────────────────────────────────────────────┘
```

This means:
- **Auto-print ON**: New orders → Print → Auto-move to "Active"
- **Auto-print OFF**: New orders stay in "New" until manually printed/acknowledged

---

## Success Criteria

✅ Clean, professional interface like Square  
✅ Orders list is easy to scan  
✅ Selected order shows full details  
✅ Print buttons are prominent and easy to tap  
✅ Status changes are quick and intuitive  
✅ Works great on tablet in landscape mode  

---

*Let's build something beautiful! 🎨*

