# Bug Handoff: Modifier Price Not Saved to Order Items

**Date:** 2026-02-10  
**Priority:** High  
**Affects:** Tablet display, receipt printing, order accuracy  
**Reported by:** Pizzalicious restaurant

---

## Summary

When saving orders to the database, **modifier prices are being written as `$0.00`** even though:
- The website displays the correct price
- The customer is charged the correct amount via Stripe

This causes the tablet and printer to show incorrect item pricing.

---

## Evidence

### Affected Orders (Pizzalicious, restaurant_id: 829)

| Order | Item | Modifier | Saved Price | Should Be |
|-------|------|----------|-------------|-----------|
| ORD-1770677891030-FY0H7M | Meat Lovers Pizza (Large) | Hot Peppers | $0.00 | $3.25 |
| ORD-1770677392505-DL7R3Q | Meat Lovers Pizza (Large) | Hot Peppers | $0.00 | $3.25 |
| ORD-1770433584262-XBNRUC | Meat Lovers Pizza (Large) | Hot Peppers | $0.00 | $3.25 |

### What's in the Database

**`modifier_prices` table (correct):**
```sql
SELECT size_variant, price FROM menuca_v3.modifier_prices WHERE modifier_id = 122598;
```
| size_variant | price |
|--------------|-------|
| Small | $1.50 |
| Medium | $2.50 |
| Large | $3.25 |

**`orders.items` JSONB (incorrect):**
```json
{
  "id": 122598,
  "name": "Hot Peppers",
  "price": 0,           // ❌ Should be 3.25 for Large pizza
  "quantity": 1,
  "placement": null
}
```

---

## Root Cause

The order creation flow is **not looking up the size-specific modifier price** when serializing cart items to the `orders.items` JSONB field.

The checkout/payment flow correctly calculates the total (customer is charged right), but the order record doesn't capture the modifier prices.

---

## Where to Fix

Look for the code that:
1. Builds the `items` array for the order INSERT/UPDATE
2. Serializes modifiers from the cart to the database format

The fix needs to:
1. Get the selected dish size (e.g., "Large")
2. Look up the modifier price for that size from `modifier_prices.size_variant`
3. Include that price in the modifier object

---

## Tables Involved

```sql
-- Modifier base info
menuca_v3.modifiers (id, name_en, modifier_group_id)

-- Size-specific pricing
menuca_v3.modifier_prices (modifier_id, size_variant, price, modifier_size_variant_id)

-- Order storage
menuca_v3.orders.items (JSONB array of items with nested modifiers)
```

---

## Test Query

After fixing, verify with:
```sql
SELECT 
  o.order_number,
  item->>'name' as dish,
  mod->>'name' as modifier,
  mod->>'price' as saved_price
FROM menuca_v3.orders o,
  jsonb_array_elements(o.items) as item,
  jsonb_array_elements(item->'modifiers') as mod
WHERE o.restaurant_id = 829
  AND mod->>'name' = 'Hot Peppers'
ORDER BY o.created_at DESC
LIMIT 5;
```

The `saved_price` should match the size-specific price from `modifier_prices`.

---

## Impact

- **Tablet:** Shows wrong modifier prices
- **Printer:** Prints wrong modifier prices  
- **Accounting:** Item-level totals don't match actual charges
- **Customer trust:** Receipt doesn't match credit card charge

---

## Notes

- Payment/Stripe side is working correctly - customers ARE being charged right
- This is purely a data serialization issue when saving the order
- The Garlic Sauce modifier in the same orders saved correctly with `price: 1.5`
- Issue may be specific to size-variant modifiers vs flat-price modifiers
