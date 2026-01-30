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

/**
 * Update order status directly via Supabase RPC
 * Bypasses PHP backend restrictions for simplified view
 */
export async function tabletUpdateOrderStatus(
  orderId: string,
  newStatus: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[SupabaseRPC] Updating order ${orderId} to ${newStatus}`);
    
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
          p_order_id: parseInt(orderId, 10),
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
