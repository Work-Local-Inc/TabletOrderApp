import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Color palettes
export const lightTheme = {
  // Backgrounds
  background: '#f5f5f5',
  surface: '#ffffff',
  card: '#ffffff',
  cardBorder: '#e0e0e0',
  
  // Header
  headerBg: '#ffffff',
  headerBorder: '#e0e0e0',
  
  // Text
  text: '#1a1a1a',
  textSecondary: '#666666',
  textMuted: '#999999',
  
  // Status colors
  statusNew: '#FF5722',
  statusActive: '#2196F3',
  statusReady: '#4CAF50',
  statusCompleted: '#9E9E9E',
  
  // Accent
  primary: '#FF5722',
  primaryLight: '#FF8A65',
  success: '#4CAF50',
  warning: '#FFC107',
  danger: '#F44336',
  
  // Print queue
  printQueueBg: '#FFF3E0',
  printedBg: '#E8F5E9',
  
  // Buttons
  buttonBg: '#FF5722',
  buttonText: '#ffffff',
  
  // Settings specific
  settingsBg: '#f5f5f5',
  settingsCard: '#ffffff',
  switchTrack: '#e0e0e0',
  
  // Misc
  overlay: 'rgba(0,0,0,0.5)',
  shadow: '#000000',
};

export const darkTheme = {
  // Backgrounds
  background: '#1a1a2e',
  surface: '#16213e',
  card: '#0f3460',
  cardBorder: '#1f4287',
  
  // Header
  headerBg: '#16213e',
  headerBorder: '#0f3460',
  
  // Text
  text: '#ffffff',
  textSecondary: '#b0b0b0',
  textMuted: '#808080',
  
  // Status colors (same for visibility)
  statusNew: '#FF5722',
  statusActive: '#2196F3',
  statusReady: '#4CAF50',
  statusCompleted: '#9E9E9E',
  
  // Accent
  primary: '#FF5722',
  primaryLight: '#FF8A65',
  success: '#4CAF50',
  warning: '#FFC107',
  danger: '#F44336',
  
  // Print queue
  printQueueBg: '#2a1a1e',
  printedBg: '#1a2a1e',
  
  // Buttons
  buttonBg: '#FF5722',
  buttonText: '#ffffff',
  
  // Settings specific
  settingsBg: '#1a1a2e',
  settingsCard: '#16213e',
  switchTrack: '#0f3460',
  
  // Misc
  overlay: 'rgba(0,0,0,0.7)',
  shadow: '#000000',
};

export type Theme = typeof darkTheme;
export type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  themeMode: ThemeMode;
  toggleTheme: () => void;
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = '@app_theme_mode';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('light'); // Default to light

  // Load saved theme on mount
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme === 'light' || savedTheme === 'dark') {
          setThemeModeState(savedTheme);
        }
      } catch (error) {
        console.log('Failed to load theme preference:', error);
      }
    };
    loadTheme();
  }, []);

  const setThemeMode = async (mode: ThemeMode) => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
      setThemeModeState(mode);
    } catch (error) {
      console.log('Failed to save theme preference:', error);
    }
  };

  const toggleTheme = () => {
    setThemeMode(themeMode === 'dark' ? 'light' : 'dark');
  };

  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider value={{ theme, themeMode, toggleTheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Helper hook that just returns the theme colors
export const useColors = (): Theme => {
  const { theme } = useTheme();
  return theme;
};

