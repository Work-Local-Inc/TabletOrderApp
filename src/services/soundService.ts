/**
 * Simple Sound Service for playing notification alerts
 * Uses expo-av Audio module
 */

import { Audio } from 'expo-av';

// Pre-resolve the asset at module load time
const NOTIFICATION_ASSET = require('../../assets/notification.mp3');

let alertSound: Audio.Sound | null = null;
let isLoading = false;

/**
 * Initialize the sound (call once on app start)
 */
export const initSound = async (): Promise<void> => {
  if (alertSound || isLoading) return;
  
  isLoading = true;
  try {
    console.log('[Sound] Loading notification sound...');
    
    // Set audio mode for playback
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });
    
    const { sound } = await Audio.Sound.createAsync(
      NOTIFICATION_ASSET,
      { shouldPlay: false, volume: 1.0 }
    );
    alertSound = sound;
    console.log('[Sound] ✓ Sound loaded successfully');
  } catch (error) {
    console.error('[Sound] ✗ Failed to load sound:', error);
  } finally {
    isLoading = false;
  }
};

/**
 * Play the alert sound
 */
export const playAlert = async (): Promise<void> => {
  try {
    if (!alertSound) {
      console.log('[Sound] Sound not loaded, initializing...');
      await initSound();
    }
    
    if (alertSound) {
      // Reset to beginning and play
      await alertSound.setPositionAsync(0);
      await alertSound.playAsync();
      console.log('[Sound] 🔔 Playing alert!');
    } else {
      console.warn('[Sound] No alert sound available');
    }
  } catch (error) {
    console.error('[Sound] ✗ Failed to play sound:', error);
  }
};

/**
 * Cleanup sound on app unmount
 */
export const cleanupSound = async (): Promise<void> => {
  if (alertSound) {
    await alertSound.unloadAsync();
    alertSound = null;
  }
};

