/**
 * Simple Sound Service for playing notification alerts
 * Uses expo-av Audio module
 * 
 * Creates a new Sound instance each time to avoid Android
 * "player is accessed on the wrong thread" errors.
 */

import { Audio } from 'expo-av';

// Pre-resolve the asset at module load time
const NOTIFICATION_ASSET = require('../../assets/notification.mp3');

let initialized = false;

/**
 * Initialize audio mode (call once on app start)
 */
export const initSound = async (): Promise<void> => {
  if (initialized) return;
  
  try {
    console.log('[Sound] Initializing audio mode...');
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
    });
    initialized = true;
    console.log('[Sound] ✓ Audio mode initialized');
  } catch (error) {
    console.error('[Sound] ✗ Failed to initialize audio:', error);
  }
};

/**
 * Play the alert sound
 * Creates a fresh Sound instance each time to avoid Android threading issues.
 */
export const playAlert = async (): Promise<void> => {
  try {
    if (!initialized) {
      await initSound();
    }

    // Create a new sound instance each time (avoids threading errors on Android)
    const { sound } = await Audio.Sound.createAsync(
      NOTIFICATION_ASSET,
      { shouldPlay: true, volume: 1.0 }
    );
    
    console.log('[Sound] 🔔 Playing alert!');
    
    // Auto-cleanup after playback finishes
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
      }
    });
  } catch (error) {
    console.error('[Sound] ✗ Failed to play sound:', error);
  }
};

/**
 * Cleanup all active sounds on app unmount
 */
export const cleanupSound = async (): Promise<void> => {
  for (const sound of activeSounds) {
    try {
      await sound.unloadAsync();
    } catch {
      // Ignore errors during cleanup
    }
  }
  activeSounds = [];
  initialized = false;
};