# 🍳 Kitchen Ticket vs Customer Receipt - Implementation Plan

**Created:** Nov 28, 2025  
**Status:** IN PROGRESS  
**Goal:** Make printed orders useful for kitchen staff with big, bold, easy-to-read tickets

---

## The Problem

Currently, orders print like receipts with small text, prices, and totals. Kitchen staff need:
- **BIG text** they can read from a distance
- **Just the food items** they need to make
- **Customer name** to call out when ready
- **Special instructions** they can't miss

---

## The Solution

Create TWO print formats:

### 1. 🍳 KITCHEN TICKET (for the cook board)
```
========================================
        🔥 KITCHEN ORDER 🔥
========================================

        ** PICKUP **
        
========================================
   CUSTOMER: JOHN SMITH
========================================

ORDER #ORD-123456

------ MAKE THESE ITEMS ------

>>> 2x PEPPERONI PIZZA
    - Extra cheese
    - Well done

>>> 1x CAESAR SALAD
    - No croutons
    - Dressing on side

>>> 3x GARLIC BREAD

------------------------------------------
⚠️  SPECIAL INSTRUCTIONS:
    Nut allergy - be careful!
------------------------------------------

Time: 6:15 PM
========================================
```

### 2. 🧾 CUSTOMER RECEIPT (for the bag/customer)
```
================================================
              ORDER #ORD-123456
================================================
             *** PICKUP ***
           Nov 28, 2025, 6:15 PM
------------------------------------------------
Customer: John Smith
Phone: 555-123-4567

================================================
                   ITEMS
================================================
2x Pepperoni Pizza                        $24.00
  - Extra cheese
1x Caesar Salad                           $12.00
  - No croutons
3x Garlic Bread                            $9.00
------------------------------------------------
Subtotal:                                 $45.00
Tax:                                       $5.85
================================================
TOTAL:                                    $50.85
================================================

            Thank you!
```

---

## Tasks

- [x] **Task 1:** Create `generateKitchenTicket()` function in printService.ts ✅
  - Large text using ESC/POS double-height/width commands
  - Customer name prominent
  - Items without prices
  - Special instructions highlighted

- [x] **Task 2:** Rename current function to `generateCustomerReceipt()` ✅
  - Keep existing receipt format
  - Clean up formatting

- [x] **Task 3:** Add `printKitchenTicket()` and `printCustomerReceipt()` exports ✅
  - Also added `printBoth()` for printing both at once

- [x] **Task 4:** Update OrdersListScreen UI ✅
  - Added print type selector in header (🍳 Kitchen / 🧾 Receipt / 📋 Both)
  - Auto-print uses selected type
  - Selection persists in settings

- [x] **Task 5:** Add settings for print preferences ✅
  - Added `defaultPrintType` to store settings
  - Settings persist across app restarts
  - Print type syncs between UI and store

- [ ] **Task 6:** Test & refine formatting
  - Adjust character widths for thermal printer
  - Test with real orders at work

- [ ] **Task 7:** Archive this plan file to `AI AGENTS READ ME/completed/`

---

## Technical Notes

### ESC/POS Commands for Large Text
```typescript
const DOUBLE_HEIGHT = '\x1D\x21\x01';  // GS ! 1
const DOUBLE_WIDTH = '\x1D\x21\x10';   // GS ! 16
const DOUBLE_SIZE = '\x1D\x21\x11';    // GS ! 17 (both)
const NORMAL_SIZE = '\x1D\x21\x00';    // GS ! 0
```

### Files to Modify
- `src/services/printService.ts` - Add new print functions
- `src/screens/OrdersListScreen.tsx` - Add print type options
- `src/screens/SettingsScreen.tsx` - Add print preferences
- `src/store/useStore.ts` - Add print preference state

---

## Success Criteria

✅ Kitchen staff can read order tickets from 3+ feet away  
✅ Customer name is immediately visible  
✅ Food items are clear with modifications  
✅ Special instructions stand out  
✅ Customer receipts still have all pricing info  
✅ Can choose which format(s) to print  

---

*Let's make those kitchen tickets! 🚀*

