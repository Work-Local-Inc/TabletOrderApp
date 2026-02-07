import { useEffect, useCallback, useState } from 'react';
import * as Updates from 'expo-updates';
import { AppState, AppStateStatus } from 'react-native';

interface UpdateState {
  isChecking: boolean;
  isDownloading: boolean;
  updateAvailable: boolean;
  error: string | null;
}

/**
 * Hook to check for and apply OTA updates from EAS Update.
 * Checks on app start and when app comes to foreground.
 * Auto-reloads when update is available (kiosk mode - no user prompt).
 */
export const useAppUpdates = () => {
  const [state, setState] = useState<UpdateState>({
    isChecking: false,
    isDownloading: false,
    updateAvailable: false,
    error: null,
  });

  const checkForUpdate = useCallback(async (silent = false) => {
    // Skip in development mode - expo-updates doesn't work in dev
    if (__DEV__) {
      console.log('[Updates] Skipping check in dev mode');
      return;
    }

    try {
      setState(s => ({ ...s, isChecking: true, error: null }));
      console.log('[Updates] Checking for updates...');
      
      const update = await Updates.checkForUpdateAsync();
      
      if (update.isAvailable) {
        console.log('[Updates] Update available, downloading...');
        setState(s => ({ ...s, isChecking: false, isDownloading: true, updateAvailable: true }));
        
        await Updates.fetchUpdateAsync();
        
        console.log('[Updates] Update downloaded, reloading...');
        setState(s => ({ ...s, isDownloading: false }));
        
        // Auto-reload for tablet kiosk mode (no user prompt)
        await Updates.reloadAsync();
      } else {
        console.log('[Updates] App is up to date');
        setState(s => ({ ...s, isChecking: false, updateAvailable: false }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Updates] Check failed:', message);
      setState(s => ({ ...s, isChecking: false, isDownloading: false, error: message }));
      
      // Don't alert in silent mode (background checks)
      // Error is logged but app continues normally
      if (!silent) {
        console.error('[Updates] Update check failed:', error);
      }
    }
  }, []);

  // Check on app start
  useEffect(() => {
    // Small delay to let app fully initialize
    const timer = setTimeout(() => {
      checkForUpdate(true);
    }, 2000);
    
    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  // Check when app comes to foreground
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        checkForUpdate(true);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [checkForUpdate]);

  return {
    ...state,
    checkForUpdate,
  };
};
