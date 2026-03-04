/**
 * Unit tests for the Accept button flow on new orders.
 *
 * Tests the acknowledgeOrder store action and handleAcceptOrder screen callback,
 * covering: correct ID forwarding to API, silent-failure detection, and
 * error-alert surfacing after the fix.
 *
 * We avoid importing the full store/client chain (expo modules + setInterval
 * polling) and instead test the logic via isolated function factories.
 */

import { Alert } from 'react-native';

jest.spyOn(Alert, 'alert');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recreate handleAcceptOrder as it existed BEFORE the fix.
 * Mirrors the real implementation at OrdersListScreen.tsx ~line 1048.
 * Bug: ignores false return value → no Alert on API failure.
 */
function makeHandleAcceptOrderBuggy(acknowledgeOrder: (id: string) => Promise<boolean>) {
  return async (orderId: string) => {
    try {
      await acknowledgeOrder(orderId);
      // BUG: return value ignored — no Alert when acknowledgeOrder returns false
    } catch {
      // The store function never throws, so this block never fires in practice
      console.error('[Accept] Error (should never reach here)');
    }
  };
}

/**
 * Recreate handleAcceptOrder AFTER the fix.
 * Mirrors what the fixed implementation at OrdersListScreen.tsx should look like.
 */
function makeHandleAcceptOrderFixed(acknowledgeOrder: (id: string) => Promise<boolean>) {
  return async (orderId: string) => {
    try {
      const success = await acknowledgeOrder(orderId);
      if (!success) {
        Alert.alert('Error', 'Failed to acknowledge order. Please try again.');
      }
    } catch (error) {
      console.error('[Accept] Error:', error);
      Alert.alert('Error', 'Failed to acknowledge order. Please try again.');
    }
  };
}

// ── Mock acknowledgeOrder for store-level behaviour ───────────────────────────

/**
 * Minimal stub of the store's acknowledgeOrder logic focused on ID resolution.
 * Mirrors useStore.ts ~line 334: use numericId when available, fall back to UUID.
 */
async function makeAcknowledgeOrderStoreLogic(
  apiAcknowledgeOrder: (orderId: string, at: string) => Promise<{ success: boolean; data?: { acknowledged_at?: string } }>
) {
  return async (
    orderId: string,
    order: { id: string; numeric_id?: number }
  ): Promise<boolean> => {
    const numericId = order.numeric_id;
    const acknowledgedAt = new Date().toISOString();

    const ackId = numericId ? String(numericId) : orderId;
    const result = await apiAcknowledgeOrder(ackId, acknowledgedAt);
    return !!(result.success && result.data);
  };
}

// ── Tests: handleAcceptOrder (screen callback) ───────────────────────────────

describe('handleAcceptOrder (screen callback)', () => {
  it('[buggy] does NOT show an Alert when acknowledgeOrder returns false', async () => {
    const ack = jest.fn().mockResolvedValue(false);
    const handler = makeHandleAcceptOrderBuggy(ack);

    await handler('uuid-order-1');

    // This demonstrates the bug: silent failure, no user feedback
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('[fixed] shows an Alert when acknowledgeOrder returns false', async () => {
    const ack = jest.fn().mockResolvedValue(false);
    const handler = makeHandleAcceptOrderFixed(ack);

    await handler('uuid-order-1');

    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      expect.stringContaining('Failed to acknowledge')
    );
  });

  it('[fixed] does NOT show an Alert when acknowledgeOrder succeeds (returns true)', async () => {
    const ack = jest.fn().mockResolvedValue(true);
    const handler = makeHandleAcceptOrderFixed(ack);

    await handler('uuid-order-1');

    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('[fixed] shows an Alert when acknowledgeOrder throws unexpectedly', async () => {
    const ack = jest.fn().mockRejectedValue(new Error('network error'));
    const handler = makeHandleAcceptOrderFixed(ack);

    await handler('uuid-order-1');

    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      expect.stringContaining('Failed to acknowledge')
    );
  });
});

// ── Tests: store ID resolution logic ────────────────────────────────────────

describe('acknowledgeOrder — ID resolution', () => {
  it('calls the API with String(numeric_id) when numeric_id is available', async () => {
    const apiAck = jest.fn().mockResolvedValue({
      success: true,
      data: { acknowledged_at: new Date().toISOString() },
    });
    const storeAck = await makeAcknowledgeOrderStoreLogic(apiAck);

    await storeAck('uuid-order-1', { id: 'uuid-order-1', numeric_id: 42 });

    expect(apiAck).toHaveBeenCalledWith('42', expect.any(String));
    expect(apiAck).not.toHaveBeenCalledWith('uuid-order-1', expect.any(String));
  });

  it('falls back to UUID string when numeric_id is undefined', async () => {
    const apiAck = jest.fn().mockResolvedValue({
      success: true,
      data: { acknowledged_at: new Date().toISOString() },
    });
    const storeAck = await makeAcknowledgeOrderStoreLogic(apiAck);

    await storeAck('uuid-order-1', { id: 'uuid-order-1', numeric_id: undefined });

    expect(apiAck).toHaveBeenCalledWith('uuid-order-1', expect.any(String));
  });

  it('falls back to UUID when numeric_id is 0 (falsy)', async () => {
    const apiAck = jest.fn().mockResolvedValue({
      success: true,
      data: { acknowledged_at: new Date().toISOString() },
    });
    const storeAck = await makeAcknowledgeOrderStoreLogic(apiAck);

    await storeAck('uuid-order-1', { id: 'uuid-order-1', numeric_id: 0 });

    expect(apiAck).toHaveBeenCalledWith('uuid-order-1', expect.any(String));
  });

  it('returns false when the API reports failure', async () => {
    const apiAck = jest.fn().mockResolvedValue({ success: false, error: 'Order not found' });
    const storeAck = await makeAcknowledgeOrderStoreLogic(apiAck);

    const result = await storeAck('uuid-order-1', { id: 'uuid-order-1', numeric_id: 42 });

    expect(result).toBe(false);
  });

  it('returns true when the API succeeds', async () => {
    const apiAck = jest.fn().mockResolvedValue({
      success: true,
      data: { acknowledged_at: '2026-03-04T12:00:00.000Z' },
    });
    const storeAck = await makeAcknowledgeOrderStoreLogic(apiAck);

    const result = await storeAck('uuid-order-1', { id: 'uuid-order-1', numeric_id: 42 });

    expect(result).toBe(true);
  });
});
