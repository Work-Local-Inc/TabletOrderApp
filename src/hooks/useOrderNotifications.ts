import { useEffect, useRef, useCallback } from 'react';
import { Platform, Vibration } from 'react-native';
import { useStore } from '../store/useStore';
import { Order } from '../types';
import { printOrder } from '../services/printService';
import { initSound, playAlert, cleanupSound } from '../services/soundService';

/**
 * Hook to handle notifications for new orders
 * - Plays sound when new orders arrive
 * - Vibrates the device
 * - Auto-prints if enabled
 */
export const useOrderNotifications = () => {
  const { orders, settings } = useStore();
  const previousOrderIdsRef = useRef<Set<string>>(new Set());
  const ringIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize sound on mount
  useEffect(() => {
    initSound();
    return () => { cleanupSound(); };
  }, []);

  const playNotificationSound = useCallback(async () => {
    if (!settings.soundEnabled) return;
    await playAlert();
  }, [settings.soundEnabled]);

  const playReminderSound = useCallback(async () => {
    if (!settings.soundEnabled) return;
    // Triple-chime reminder so it's audibly distinct from a new order
    await playAlert();
    setTimeout(() => { playAlert(); }, 250);
    setTimeout(() => { playAlert(); }, 500);
  }, [settings.soundEnabled]);

  const vibrateDevice = useCallback(() => {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      // Vibrate pattern: [wait, vibrate, wait, vibrate]
      Vibration.vibrate([0, 500, 200, 500]);
    }
  }, []);

  const vibrateReminder = useCallback(() => {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      // Short triple buzz to match reminder chimes
      Vibration.vibrate([0, 200, 120, 200, 120, 200]);
    }
  }, []);

  const stopRinging = useCallback(() => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
  }, []);

  const startRinging = useCallback(() => {
    if (ringIntervalRef.current) return;
    ringIntervalRef.current = setInterval(() => {
      playReminderSound();
      vibrateReminder();
    }, 15000);
  }, [playReminderSound, vibrateReminder]);

  // Check for new orders
  useEffect(() => {
    const currentOrderIds = new Set(orders.orders.map((o) => o.id));
    const newOrders: Order[] = [];

    // Find orders that are new (not in previous set) and in a "new-ish" status
    orders.orders.forEach((order) => {
      if (
        !previousOrderIdsRef.current.has(order.id) &&
        (order.status === 'pending' ||
          order.status === 'confirmed' ||
          order.status === 'preparing') &&
        !order.acknowledged_at
      ) {
        newOrders.push(order);
      }
    });

    // Update previous order IDs
    previousOrderIdsRef.current = currentOrderIds;

    // Process new orders
    if (newOrders.length > 0) {
      // Play sound and vibrate
      playNotificationSound();
      vibrateDevice();

      // Auto-print if enabled
      if (settings.autoPrint) {
        newOrders.forEach((order) => {
          printOrder(order).catch((error) => {
            console.error('Failed to auto-print order:', error);
          });
        });
      }
    }
  }, [
    orders.orders,
    playNotificationSound,
    vibrateDevice,
    settings.autoPrint,
  ]);

  // Repeat alert until all pending orders are accepted (if enabled)
  useEffect(() => {
    const hasUnacceptedPending = orders.orders.some(
      (order) =>
        (order.status === 'pending' ||
          order.status === 'confirmed' ||
          order.status === 'preparing') &&
        !order.acknowledged_at
    );

    if (settings.ringUntilAccepted && hasUnacceptedPending) {
      startRinging();
    } else {
      stopRinging();
    }
  }, [orders.orders, settings.ringUntilAccepted, startRinging, stopRinging]);

  useEffect(() => {
    return () => {
      stopRinging();
    };
  }, [stopRinging]);

  return {
    playNotificationSound,
    vibrateDevice,
  };
};
