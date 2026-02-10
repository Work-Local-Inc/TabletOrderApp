/**
 * Direct Supabase RPC calls for tablet-specific operations
 * Used for simplified view where we need more flexible status transitions
 */

const SUPABASE_URL = 'https://nthpbtdjhhnwfxqsxbvy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50aHBidGRqaGhud2Z4cXN4YnZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyNzM0ODQsImV4cCI6MjA3MDg0OTQ4NH0.CfgwjVvf2DS37QguV20jf7--QZTXf6-DJR_IhFauedA';

interface StatusUpdateResult {
  success: boolean;
  error: string | null;
  old_status: string | null;
  new_status: string | null;
}

interface DeliveryConfigResult {
  config_id: number;
  has_delivery_enabled: boolean;
  pickup_enabled: boolean;
}

interface DeliveryUpdateResult {
  success: boolean;
  error: string | null;
  new_value: boolean | null;
}

/**
 * Update order status directly via Supabase RPC
 * Bypasses PHP backend restrictions for simplified view
 */
export async function tabletUpdateOrderStatus(
  numericId: number,
  newStatus: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[SupabaseRPC] Updating order (numeric_id=${numericId}) to ${newStatus}`);
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/tablet_update_order_status`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Accept-Profile': 'menuca_v3',
          'Content-Profile': 'menuca_v3',
        },
        body: JSON.stringify({
          p_order_id: numericId,
          p_new_status: newStatus,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[SupabaseRPC] HTTP error: ${response.status}`, errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const results: StatusUpdateResult[] = await response.json();
    console.log(`[SupabaseRPC] Response:`, results);

    if (results && results.length > 0) {
      const result = results[0];
      if (result.success) {
        console.log(`[SupabaseRPC] ✓ Status updated: ${result.old_status} -> ${result.new_status}`);
        return { success: true };
      } else {
        console.error(`[SupabaseRPC] ✗ Failed:`, result.error);
        return { success: false, error: result.error || 'Unknown error' };
      }
    }

    return { success: false, error: 'No response from server' };
  } catch (error) {
    console.error(`[SupabaseRPC] Exception:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get delivery config for a restaurant
 */
export async function tabletGetDeliveryConfig(
  restaurantId: string
): Promise<{ success: boolean; data?: DeliveryConfigResult; error?: string }> {
  try {
    console.log(`[SupabaseRPC] Getting delivery config for restaurant ${restaurantId}`);
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/tablet_get_delivery_config`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Accept-Profile': 'menuca_v3',
          'Content-Profile': 'menuca_v3',
        },
        body: JSON.stringify({
          p_restaurant_id: parseInt(restaurantId, 10),
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[SupabaseRPC] HTTP error: ${response.status}`, errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const results: DeliveryConfigResult[] = await response.json();
    console.log(`[SupabaseRPC] Delivery config response:`, results);

    if (results && results.length > 0) {
      return { success: true, data: results[0] };
    }

    return { success: false, error: 'No delivery config found' };
  } catch (error) {
    console.error(`[SupabaseRPC] Exception:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Update delivery enabled status for a restaurant
 */
export async function tabletUpdateDeliveryEnabled(
  restaurantId: string,
  hasDeliveryEnabled: boolean
): Promise<{ success: boolean; newValue?: boolean; error?: string }> {
  try {
    console.log(`[SupabaseRPC] Updating delivery enabled for restaurant ${restaurantId} to ${hasDeliveryEnabled}`);
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/tablet_update_delivery_enabled`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Accept-Profile': 'menuca_v3',
          'Content-Profile': 'menuca_v3',
        },
        body: JSON.stringify({
          p_restaurant_id: parseInt(restaurantId, 10),
          p_has_delivery_enabled: hasDeliveryEnabled,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[SupabaseRPC] HTTP error: ${response.status}`, errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const results: DeliveryUpdateResult[] = await response.json();
    console.log(`[SupabaseRPC] Update delivery response:`, results);

    if (results && results.length > 0) {
      const result = results[0];
      if (result.success) {
        console.log(`[SupabaseRPC] ✓ Delivery enabled updated to: ${result.new_value}`);
        return { success: true, newValue: result.new_value ?? hasDeliveryEnabled };
      } else {
        console.error(`[SupabaseRPC] ✗ Failed:`, result.error);
        return { success: false, error: result.error || 'Unknown error' };
      }
    }

    return { success: false, error: 'No response from server' };
  } catch (error) {
    console.error(`[SupabaseRPC] Exception:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
