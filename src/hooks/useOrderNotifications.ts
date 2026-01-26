import { useEffect, useRef, useCallback } from 'react';
import { Platform, Vibration } from 'react-native';
import { useStore } from '../store/useStore';
import { Order } from '../types';
import { printOrder } from '../services/printService';

// Sound will be loaded dynamically if available
let AudioModule: any = null;

/**
 * Hook to handle notifications for new orders
 * - Plays sound when new orders arrive
 * - Vibrates the device
 * - Auto-prints if enabled
 */
export const useOrderNotifications = () => {
  const { orders, settings } = useStore();
  const previousOrderIdsRef = useRef<Set<string>>(new Set());
  const soundRef = useRef<any>(null);
  const soundLoadedRef = useRef(false);

  // Load notification sound (optional - requires expo-av and sound file)
  useEffect(() => {
    const loadSound = async () => {
      if (soundLoadedRef.current) return;

      try {
        // Dynamically import expo-av
        AudioModule = await import('expo-av');

        // Try to load the sound file
        const { sound } = await AudioModule.Audio.Sound.createAsync(
          require('../../assets/notification.mp3'),
          { shouldPlay: false }
        );
        soundRef.current = sound;
        soundLoadedRef.current = true;
      } catch (error) {
        // Sound file not found or expo-av not installed
        // Notifications will still work via vibration
        console.log('Notification sound not available (add notification.mp3 to assets)');
      }
    };

    loadSound();

    return () => {
      if (soundRef.current?.unloadAsync) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const playNotificationSound = useCallback(async () => {
    if (!settings.soundEnabled) return;

    try {
      if (soundRef.current) {
        await soundRef.current.replayAsync();
      }
    } catch (error) {
      console.log('Could not play notification sound:', error);
    }
  }, [settings.soundEnabled]);

  const vibrateDevice = useCallback(() => {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      // Vibrate pattern: [wait, vibrate, wait, vibrate]
      Vibration.vibrate([0, 500, 200, 500]);
    }
  }, []);

  // Check for new orders
  useEffect(() => {
    const currentOrderIds = new Set(orders.orders.map((o) => o.id));
    const newOrders: Order[] = [];

    // Find orders that are new (not in previous set) and pending
    orders.orders.forEach((order) => {
      if (
        !previousOrderIdsRef.current.has(order.id) &&
        order.status === 'pending' &&
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

  return {
    playNotificationSound,
    vibrateDevice,
  };
};
