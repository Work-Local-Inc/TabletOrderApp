/**
 * Simple Sound Service for playing notification alerts
 * Uses expo-av Audio module
 */

import { Audio } from 'expo-av';

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
    const { sound } = await Audio.Sound.createAsync(
      require('../../assets/notification.mp3'),
      { shouldPlay: false }
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




