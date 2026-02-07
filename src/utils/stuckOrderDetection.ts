import { Order, OrderStatus, StuckOrderInfo } from '../types';

/**
 * Thresholds for detecting stuck orders (in minutes).
 * An order is considered "stuck" if it has been in a status
 * for longer than the threshold.
 * 
 * These are conservative thresholds to avoid false positives.
 * The backend can decide whether to trigger alerts based on
 * additional context (time of day, restaurant preferences, etc.)
 */
const STUCK_THRESHOLDS: Partial<Record<OrderStatus, number>> = {
  pending: 5,       // New order not acknowledged after 5 min - CRITICAL
  confirmed: 15,    // Confirmed but not preparing after 15 min
  preparing: 30,    // Preparing for more than 30 min
  ready: 20,        // Ready but not picked up/completed after 20 min
};

/**
 * Statuses we don't track for stuck detection.
 * These are terminal states or states that can legitimately take a long time.
 */
const IGNORED_STATUSES: OrderStatus[] = [
  'out_for_delivery',  // Delivery time varies widely
  'delivered',         // Terminal state
  'completed',         // Terminal state
  'cancelled',         // Terminal state
];

/**
 * Detects orders that have been in the same status for too long.
 * Returns an array of stuck orders sorted by how long they've been stuck.
 * 
 * @param orders - Current list of orders from the store
 * @returns Array of StuckOrderInfo for orders exceeding their threshold
 */
export const detectStuckOrders = (orders: Order[]): StuckOrderInfo[] => {
  const now = Date.now();
  const stuckOrders: StuckOrderInfo[] = [];

  for (const order of orders) {
    // Skip ignored statuses
    if (IGNORED_STATUSES.includes(order.status)) {
      continue;
    }

    const threshold = STUCK_THRESHOLDS[order.status];
    
    // Skip statuses we don't have a threshold for
    if (threshold === undefined) {
      continue;
    }
    
    // Calculate time in current status
    // Use updated_at if available (when status changed), otherwise created_at
    const statusTime = new Date(order.updated_at || order.created_at).getTime();
    const minutesInStatus = Math.floor((now - statusTime) / 60000);
    
    // Only include if exceeds threshold
    if (minutesInStatus >= threshold) {
      stuckOrders.push({
        order_id: order.id,
        order_number: order.order_number,
        status: order.status,
        minutes_stuck: minutesInStatus,
        created_at: order.created_at,
      });
    }
  }

  // Sort by most stuck first (highest minutes_stuck)
  return stuckOrders.sort((a, b) => b.minutes_stuck - a.minutes_stuck);
};

/**
 * Get the threshold for a specific status.
 * Useful for displaying warnings in the UI.
 */
export const getThresholdForStatus = (status: OrderStatus): number | undefined => {
  return STUCK_THRESHOLDS[status];
};

/**
 * Check if a single order is stuck.
 */
export const isOrderStuck = (order: Order): boolean => {
  const threshold = STUCK_THRESHOLDS[order.status];
  if (threshold === undefined) return false;
  
  const statusTime = new Date(order.updated_at || order.created_at).getTime();
  const minutesInStatus = Math.floor((Date.now() - statusTime) / 60000);
  
  return minutesInStatus >= threshold;
};

/**
 * Get how many minutes until an order is considered stuck.
 * Returns undefined if the status isn't tracked.
 * Returns 0 or negative if already stuck.
 */
export const getMinutesUntilStuck = (order: Order): number | undefined => {
  const threshold = STUCK_THRESHOLDS[order.status];
  if (threshold === undefined) return undefined;
  
  const statusTime = new Date(order.updated_at || order.created_at).getTime();
  const minutesInStatus = Math.floor((Date.now() - statusTime) / 60000);
  
  return threshold - minutesInStatus;
};
