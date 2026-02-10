# 🖨️ Print Format Reference - KNOWN GOOD STATE

**Last Verified Working:** December 17, 2025  
**Status:** ✅ PRODUCTION READY

This document serves as a reference for the print format when it was working perfectly. **DO NOT CHANGE** the print formatting without:
1. Testing on actual thermal printer
2. Updating this document
3. Getting approval

---

## 🍳 Kitchen Ticket Format (KOT)

### Header
```
========================================
        #12345
========================================
Type: DELIVERY
Time: 8:50 AM

Phone: 6138367722

        SAUL GOODMAN
```

### Scheduled Order Section (if applicable)
```
----------------------------------------
        SCHEDULED ORDER
    Dec 17, 2025, 11:00 AM
----------------------------------------
```
**CRITICAL:** 
- Asterisks use **NORMAL SIZE** (not double)
- Date format is **ASCII ONLY** (no locale-specific characters)
- Uses `formatScheduledTime()` which manually formats dates

### Items Section
```
----------------------------------------
ITEMS: (1 item)
----------------------------------------
        1x 2 Small Halifax Donairs
   - Cheese
   - Pepsi
   - Iced Tea
   >> Please place 1 cheese per Donair...
```

### Modifiers
- Show as: `   - Modifier Name x2` (if quantity > 1)
- Placement shown as: `(LEFT)` or `(RIGHT)` if not whole

### Allergy Alerts
```
----------------------------------------
        !! ALLERGY !!
   2 Small Halifax Donairs: Please place...
----------------------------------------
```

### Delivery Address (if delivery order)
```
----------------------------------------
DELIVER TO:
422 Bronson Avenue
Ottawa, ON, K1R6J6
----------------------------------------
DELIVERY NOTE:
Dog is sick please leave pizza at front door
----------------------------------------
```

---

## 🧾 Customer Receipt Format

### Header
```
========================================
        YOUR ORDER
========================================
        #12345
========================================
*** DELIVERY ***
Dec 17, 2025, 8:50 AM
----------------------------------------
Customer: Saul Goodman
Phone: 6138367722
```

### Scheduled Order Section (if applicable)
```
----------------------------------------
        SCHEDULED ORDER
    Dec 17, 2025, 11:00 AM
----------------------------------------
```

### Items with Prices
```
========================================
        ITEMS (1)
========================================
1x 2 Small Halifax Donairs        $24.00
   - Cheese x2
   - Pepsi
   - Iced Tea
```

---

## ⚠️ CRITICAL RULES

### 1. ASCII-Only Text
- **NEVER** use `toLocaleString()` or locale-dependent formatting
- **ALWAYS** use manual date formatting with ASCII months
- **ALWAYS** sanitize with `sanitizeForPrinter()` before printing

### 2. Text Sizing
- **DOUBLE_SIZE** = Half width (21 chars = 42 normal chars wide)
- **DOUBLE_HEIGHT** = Full width, double height (48 chars wide)
- **NORMAL_SIZE** = Full width (42 chars wide)

### 3. Divider Lines
- Use **NORMAL SIZE** for asterisks/dividers (not double-size)
- Width: `PAPER_WIDTH` (42) for normal, `PAPER_WIDTH_DOUBLE` (21) for double-size text

### 4. Modifier Quantities
- Check for `mod.quantity` field
- Display as: `Modifier Name x2` if quantity > 1

### 5. Date Formatting Functions
- `formatDateTime()` - Full date/time (ASCII only)
- `formatTimeOnly()` - Time only (ASCII only)  
- `formatScheduledTime()` - Scheduled date/time (ASCII only, manual formatting)

---

## 🧪 Testing Checklist

Before deploying print format changes:

- [ ] Print test order with scheduled time
- [ ] Print test order with modifiers (including quantities)
- [ ] Print test order with delivery address
- [ ] Print test order with allergy alerts
- [ ] Verify NO Chinese/Unicode characters appear
- [ ] Verify asterisks are normal size (not giant)
- [ ] Verify all text is readable and properly aligned
- [ ] Test on actual thermal printer (not just simulator)

---

## 📝 Change Log

### December 17, 2025 - Fixed Issues
- ✅ Fixed giant asterisks in scheduled order section (now normal size)
- ✅ Fixed Chinese characters in scheduled time (replaced `toLocaleString` with ASCII-only formatting)
- ✅ Added modifier quantity support (`x2`, `x3`, etc.)
- ✅ Enhanced `sanitizeForPrinter()` to remove all non-ASCII characters

### Known Issues
- None currently

---

## 🔒 Protection Strategy

1. **Version Control**: All changes tracked in git
2. **Reference Document**: This file serves as "known good" state
3. **Testing**: Always test on real printer before deploying
4. **Code Review**: Print formatting changes require careful review
5. **Rollback Plan**: Keep previous working version in git history

---

## 🚨 If Print Format Breaks

1. Check git history: `git log --oneline -- src/services/printService.ts`
2. Compare with this reference document
3. Revert problematic changes: `git revert <commit-hash>`
4. Test immediately on real printer
5. Update this document with what broke and how it was fixed


