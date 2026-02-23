import React, { useEffect, useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Vibration,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
// import { Audio } from 'expo-av'; // Temporarily disabled
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useStore } from '../store/useStore';
import { Order, OrderStatus } from '../types';
import { 
  printKitchenTicket, 
  printCustomerReceipt, 
  printBoth,
  connectPrinter, 
  isPrinterConnected,
  ensureConnected,
  verifyConnection,
  getConnectedPrinterAddress,
  disconnectPrinter,
} from '../services/printService';
import { OrderListItem, OrderDetailPanel, OrderFilters, FilterStatus, KanbanBoard, OrdersBottomDock } from '../components/orders';
import { KanbanBoard4Col } from '../components/orders/KanbanBoard4Col';
import { KanbanBoard3Col } from '../components/orders/KanbanBoard3Col';
import { useTheme } from '../theme';
import { apiClient } from '../api/client';
// useHeartbeat removed - already running at app root (App.tsx)

type RootStackParamList = {
  Orders: undefined;
  OrderDetail: { orderId: string };
  Settings: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Orders'>;
type PrintType = 'kitchen' | 'receipt' | 'both';

// Storage key for printed orders
const PRINTED_ORDERS_KEY = '@printed_order_ids';

// Storage key for backlogged orders (arrived while printer was off)
const BACKLOGGED_ORDERS_KEY = '@backlogged_order_ids';

// Storage key for print counts (tracks how many times each order was printed)
const PRINT_COUNTS_KEY = '@order_print_counts';

// How often to ping for backlogged orders (in ms)
const BACKLOG_ALERT_INTERVAL_MS = 60000; // 60 seconds (1 minute)

// How often to verify printer connection (in ms)
const PRINTER_VERIFY_INTERVAL_MS = 15000; // 15 seconds
const PRINTER_DISCONNECT_ALERT_MS = 120000; // 2 minutes before alerting

// ⚠️ CRITICAL SAFETY: Maximum age (in minutes) for auto-printing
// Orders older than this will NEVER auto-print - they go to backlog instead
// This prevents infinite print loops if orders get "stuck" in pending status
const MAX_AUTO_PRINT_AGE_MINUTES = 10;

// Maximum times an order can be printed (safety limit)
const MAX_PRINT_COUNT = 2;

// Connectivity watchdog constants
const WATCHDOG_CHECK_INTERVAL_MS = 30000; // Every 30s
const WATCHDOG_STALE_WARNING_MS = 2 * 60 * 1000; // Warn/recover after 2 minutes
const WATCHDOG_RECOVERY_COOLDOWN_MS = 60 * 1000; // Max once per minute

const formatElapsedTime = (ms: number): string => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
};

export const OrdersListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { theme, themeMode } = useTheme();
  const insets = useSafeAreaInsets();
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastKnownOrderIds = useRef<Set<string>>(new Set());
  
  // NOTE: Heartbeat removed - already running at app root (App.tsx)
  // Having it here caused duplicate heartbeats (2x network, 2x battery drain)
  
  // Local state
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterStatus>('new');
  const [refreshing, setRefreshing] = useState(false);
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);
  const [healthNow, setHealthNow] = useState<number>(Date.now());
  const [recallMode, setRecallMode] = useState(false);
  const [locationLogoUrl, setLocationLogoUrl] = useState<string | null>(null);
  const lastRecoveryAttemptAt = useRef(0);
  
  // PRINTED ORDER TRACKING - React state so we properly wait for it to load
  const [printedOrderIds, setPrintedOrderIds] = useState<Set<string>>(new Set());
  const [printedIdsLoaded, setPrintedIdsLoaded] = useState(false);
  
  // BACKLOGGED ORDER TRACKING - Orders that arrived while printer was offline
  const [backloggedOrderIds, setBackloggedOrderIds] = useState<Set<string>>(new Set());
  const [backlogIdsLoaded, setBacklogIdsLoaded] = useState(false);
  const backlogAlertInterval = useRef<NodeJS.Timeout | null>(null);
  
  // PRINT COUNT TRACKING - Prevents infinite print loops (safety limit)
  const [printCounts, setPrintCounts] = useState<Map<string, number>>(new Map());
  const [printCountsLoaded, setPrintCountsLoaded] = useState(false);
  
  // Alert sound - temporarily disabled
  // const alertSoundRef = useRef<Audio.Sound | null>(null);
  
  // Track orders currently being printed to prevent double-triggers
  const currentlyPrinting = useRef<Set<string>>(new Set());
  
  // Load printed IDs from storage on mount
  useEffect(() => {
    const loadPrintedIds = async () => {
      try {
        const stored = await AsyncStorage.getItem(PRINTED_ORDERS_KEY);
        if (stored) {
          const ids = JSON.parse(stored);
          setPrintedOrderIds(new Set(ids));
          console.log(`[PrintQueue] ✓ Loaded ${ids.length} printed order IDs`);
        }
      } catch (error) {
        console.error('[PrintQueue] Error loading:', error);
      }
      setPrintedIdsLoaded(true); // Mark as loaded even on error
    };
    loadPrintedIds();
  }, []);
  
  // Load backlogged order IDs from storage on mount
  useEffect(() => {
    const loadBacklogIds = async () => {
      try {
        const stored = await AsyncStorage.getItem(BACKLOGGED_ORDERS_KEY);
        if (stored) {
          const ids = JSON.parse(stored);
          setBackloggedOrderIds(new Set(ids));
          console.log(`[Backlog] ✓ Loaded ${ids.length} backlogged order IDs`);
        }
      } catch (error) {
        console.error('[Backlog] Error loading:', error);
      }
      setBacklogIdsLoaded(true);
    };
    loadBacklogIds();
  }, []);
  
  // Load print counts from storage on mount
  useEffect(() => {
    const loadPrintCounts = async () => {
      try {
        const stored = await AsyncStorage.getItem(PRINT_COUNTS_KEY);
        if (stored) {
          const counts = JSON.parse(stored);
          setPrintCounts(new Map(Object.entries(counts)));
          console.log(`[PrintCounts] ✓ Loaded print counts for ${Object.keys(counts).length} orders`);
        }
      } catch (error) {
        console.error('[PrintCounts] Error loading:', error);
      }
      setPrintCountsLoaded(true);
    };
    loadPrintCounts();
  }, []);
  
  // Initialize sound on mount
  useEffect(() => {
    const loadSound = async () => {
      try {
        const { initSound } = await import('../services/soundService');
        await initSound();
        console.log('[OrdersListScreen] Sound initialized');
      } catch (error) {
        console.error('[OrdersListScreen] Failed to init sound:', error);
      }
    };
    loadSound();
  }, []);
  
  // Sound alert using soundService
  const playAlertSound = useCallback(async () => {
    try {
      const { playAlert } = await import('../services/soundService');
      const currentSettings = useStore.getState().settings;
      await playAlert(
        currentSettings?.printerAlertTone ??
          currentSettings?.notificationTone ??
          'default'
      );
      console.log('[Sound] 🔔 Alert triggered!');
    } catch (error) {
      console.error('[Sound] Failed to play:', error);
    }
  }, []);
  
  // Save printed IDs whenever they change
  const savePrintedIds = useCallback(async (ids: Set<string>) => {
    try {
      await AsyncStorage.setItem(PRINTED_ORDERS_KEY, JSON.stringify([...ids]));
      console.log(`[PrintQueue] ✓ Saved ${ids.size} printed IDs`);
    } catch (error) {
      console.error('[PrintQueue] Error saving:', error);
    }
  }, []);
  
  // Save backlogged IDs whenever they change
  const saveBacklogIds = useCallback(async (ids: Set<string>) => {
    try {
      await AsyncStorage.setItem(BACKLOGGED_ORDERS_KEY, JSON.stringify([...ids]));
      console.log(`[Backlog] ✓ Saved ${ids.size} backlogged IDs`);
    } catch (error) {
      console.error('[Backlog] Error saving:', error);
    }
  }, []);
  
  // Save print counts whenever they change
  const savePrintCounts = useCallback(async (counts: Map<string, number>) => {
    try {
      await AsyncStorage.setItem(PRINT_COUNTS_KEY, JSON.stringify(Object.fromEntries(counts)));
      console.log(`[PrintCounts] ✓ Saved print counts for ${counts.size} orders`);
    } catch (error) {
      console.error('[PrintCounts] Error saving:', error);
    }
  }, []);
  
  // Get print count for an order
  const getPrintCount = useCallback((orderId: string): number => {
    return printCounts.get(orderId) || 0;
  }, [printCounts]);
  
  // Increment print count for an order
  const incrementPrintCount = useCallback((orderId: string) => {
    setPrintCounts(prev => {
      const newMap = new Map(prev);
      const currentCount = newMap.get(orderId) || 0;
      newMap.set(orderId, currentCount + 1);
      savePrintCounts(newMap);
      console.log(`[PrintCounts] 📊 Order ${orderId} printed ${currentCount + 1} time(s)`);
      return newMap;
    });
  }, [savePrintCounts]);
  
  // Mark order as printed
  const markAsPrinted = useCallback((orderId: string) => {
    setPrintedOrderIds(prev => {
      const newSet = new Set(prev);
      newSet.add(orderId);
      savePrintedIds(newSet);
      console.log(`[PrintQueue] 🖨️ Marked ${orderId} as printed`);
      return newSet;
    });
    // Track print count
    incrementPrintCount(orderId);
    // Also remove from backlog if it was there
    setBackloggedOrderIds(prev => {
      if (prev.has(orderId)) {
        const newSet = new Set(prev);
        newSet.delete(orderId);
        saveBacklogIds(newSet);
        console.log(`[Backlog] ✓ Removed ${orderId} from backlog (printed)`);
        return newSet;
      }
      return prev;
    });
  }, [savePrintedIds, saveBacklogIds, incrementPrintCount]);
  
  // Add order to backlog (arrived while printer was offline)
  const addToBacklog = useCallback((orderId: string) => {
    setBackloggedOrderIds(prev => {
      if (!prev.has(orderId)) {
        const newSet = new Set(prev);
        newSet.add(orderId);
        saveBacklogIds(newSet);
        console.log(`[Backlog] ⚠️ Added ${orderId} to backlog (printer was offline)`);
        return newSet;
      }
      return prev;
    });
  }, [saveBacklogIds]);
  
  // Clear order from backlog (manually acknowledged)
  const removeFromBacklog = useCallback((orderId: string) => {
    setBackloggedOrderIds(prev => {
      if (prev.has(orderId)) {
        const newSet = new Set(prev);
        newSet.delete(orderId);
        saveBacklogIds(newSet);
        console.log(`[Backlog] ✓ Removed ${orderId} from backlog`);
        return newSet;
      }
      return prev;
    });
  }, [saveBacklogIds]);
  
  // Check if order was printed
  const wasPrinted = useCallback((orderId: string): boolean => {
    return printedOrderIds.has(orderId);
  }, [printedOrderIds]);
  
  // Check if order is backlogged
  const isBacklogged = useCallback((orderId: string): boolean => {
    return backloggedOrderIds.has(orderId);
  }, [backloggedOrderIds]);

  // Store state
  const {
    orders,
    setOrders,
    fetchOrders,
    checkAuth,
    acknowledgeOrder,
    updateOrderStatus,
    settings,
    updateSettings,
    auth,
    offline,
  } = useStore();

  const printerConnected = settings?.printerConnected ?? false;
  const viewMode = settings?.viewMode ?? 'three';
  const simplifiedView = viewMode === 'two';
  const threeColumnView = viewMode === 'three';
  const ordersList = orders?.orders || [];
  const lastFetchAtMs = orders?.lastFetchTime ? new Date(orders.lastFetchTime).getTime() : null;
  const staleFetchMs = lastFetchAtMs ? Math.max(0, healthNow - lastFetchAtMs) : null;
  const consecutiveFetchFailures = orders?.consecutiveFetchFailures ?? 0;
  const shouldShowStaleBanner = !!auth?.isAuthenticated && !!staleFetchMs && staleFetchMs >= WATCHDOG_STALE_WARNING_MS;
  const completedArchiveLimit = Math.max(1, settings?.completedArchiveLimit ?? 50);
  const completedColumnHiddenOrderIds = Array.isArray(settings?.completedColumnHiddenOrderIds)
    ? settings.completedColumnHiddenOrderIds
    : [];
  const hiddenCompletedOrderIdSet = new Set(completedColumnHiddenOrderIds);
  const isVisibleAfterCompletedClear = (order: Order): boolean => {
    return !hiddenCompletedOrderIdSet.has(order.id);
  };

  const completedOrdersBase = ordersList
    .filter(
      o =>
        (o.status === 'ready' || o.status === 'completed' || o.status === 'cancelled') &&
        isVisibleAfterCompletedClear(o)
    )
    .sort((a, b) => {
      const aTime = new Date(a.updated_at || a.created_at).getTime();
      const bTime = new Date(b.updated_at || b.created_at).getTime();
      return bTime - aTime;
    });

  const completedOrdersVisible = completedOrdersBase.slice(0, completedArchiveLimit);
  const completedOrdersArchived = completedOrdersBase.slice(completedArchiveLimit);

  const completedOnlyBase = ordersList
    .filter(
      o =>
        (o.status === 'completed' || o.status === 'cancelled') &&
        isVisibleAfterCompletedClear(o)
    )
    .sort((a, b) => {
      const aTime = new Date(a.updated_at || a.created_at).getTime();
      const bTime = new Date(b.updated_at || b.created_at).getTime();
      return bTime - aTime;
    });

  const completedOnlyVisible = completedOnlyBase.slice(0, completedArchiveLimit);
  const completedOnlyArchived = completedOnlyBase.slice(completedArchiveLimit);
  
  // Find selected order
  const selectedOrder = selectedOrderId 
    ? ordersList.find(o => o.id === selectedOrderId) || null
    : null;

  // Print function - ONLY marks as printed if print ACTUALLY succeeds
  const handlePrint = useCallback(async (order: Order) => {
    console.log(`[Print] 🖨️ Starting print for order #${order.order_number}...`);
    
    // ⚠️ SAFETY: Warn if order has been printed multiple times (possible loop detected)
    const orderPrintCount = printCounts.get(order.id) || 0;
    if (orderPrintCount >= MAX_PRINT_COUNT) {
      console.warn(`[Print] ⛔ Order ${order.id} already printed ${orderPrintCount} times!`);
      Alert.alert(
        '⚠️ Reprint Warning',
        `This order has already been printed ${orderPrintCount} time(s).\n\nAre you sure you want to print it again?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Print Anyway', 
            style: 'destructive',
            onPress: () => {
              // Allow reprint but log it
              console.log(`[Print] ⚠️ User confirmed reprint of order ${order.id}`);
              performPrint(order);
            }
          }
        ]
      );
      return;
    }
    
    await performPrint(order);
  }, [printCounts, performPrint]);
  
  // Actual print logic (separated to allow confirmation dialog above)
  const performPrint = useCallback(async (order: Order) => {
    setPrintingOrderId(order.id);
    try {
      // Use saved printer config and always try to re-establish Bluetooth before printing.
      // `printerConnected` in settings can be stale after app restart or BT drops.
      const macAddress = settings?.printerMacAddress;
      if (!macAddress) {
        Alert.alert('No Printer Configured', 'Please connect a printer in Settings first.');
        setPrintingOrderId(null);
        return;
      }

      // Ensure we have an active connection (with one retry)
      console.log(`[Print] 🔗 Verifying connection to ${settings?.printerName}...`);
      let isConnected = await ensureConnected(macAddress);
      if (!isConnected) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        isConnected = await ensureConnected(macAddress);
      }
      
      if (!isConnected) {
        console.error('[Print] ❌ Could not establish printer connection');
        Alert.alert(
          'Printer Connection Failed', 
          `Could not connect to ${settings?.printerName}.\n\nPlease check that:\n• Printer is powered on\n• Bluetooth is enabled\n• You are within range`,
          [{ text: 'OK' }]
        );
        // Update settings to reflect actual state
        updateSettings({ printerConnected: false });
        setPrintingOrderId(null);
        return;
      }

      // Keep settings state in sync when reconnect succeeds during print/reprint
      if (!printerConnected) {
        updateSettings({ printerConnected: true });
      }
      
      console.log(`[Print] ✓ Connection verified, printing...`);
      
      const printType = settings?.defaultPrintType || 'kitchen';
      let success = false;
      
      switch (printType) {
        case 'kitchen':
          success = await printKitchenTicket(order);
          break;
        case 'receipt':
          success = await printCustomerReceipt(order);
          break;
        case 'both':
          success = await printBoth(order);
          break;
      }

      if (success) {
        console.log(`[Print] ✓ Print succeeded for order #${order.order_number}`);
        
        // ONLY mark as printed if print ACTUALLY succeeded
        markAsPrinted(order.id);
        Vibration.vibrate(100);

        // Keep order in New after auto-print; staff must explicitly Accept to move forward.
        Alert.alert('✓ Printed', `Order #${order.order_number} printed successfully`);
      } else {
        console.error(`[Print] ❌ Print FAILED for order #${order.order_number}`);
        // Update settings to reflect that printer may be disconnected
        updateSettings({ printerConnected: false });
        // Add to backlog so it can be retried
        addToBacklog(order.id);
        
        // 🚨 ALERT: Sound + vibration on print failure! (if enabled)
        if (settings?.printerAlertsEnabled ?? true) {
          playAlertSound();
          Vibration.vibrate([0, 1000, 300, 1000, 300, 1000]);
        }
        
        Alert.alert(
          '🚨 Print Failed!', 
          'Could not print the order. The printer may be off or disconnected.\n\n• Check printer power\n• Check Bluetooth connection\n• Try reconnecting in Settings',
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Go to Settings', onPress: () => navigation.navigate('Settings' as never) }
          ]
        );
      }
    } catch (error: any) {
      console.error('[Print] ❌ Error:', error);
      updateSettings({ printerConnected: false });
      // Add to backlog so it can be retried
      addToBacklog(order.id);
      
      // 🚨 ALERT: Sound + vibration on print error! (if enabled)
      if (settings?.printerAlertsEnabled ?? true) {
        playAlertSound();
        Vibration.vibrate([0, 1000, 300, 1000, 300, 1000]);
      }
      
      Alert.alert(
        '🚨 Print Error!', 
        `${error?.message || error}\n\n• Check printer power\n• Check Bluetooth connection`,
        [
            { text: 'OK', style: 'cancel' },
            { text: 'Go to Settings', onPress: () => navigation.navigate('Settings' as never) }
        ]
      );
    } finally {
      setPrintingOrderId(null);
    }
  }, [printerConnected, settings?.defaultPrintType, settings?.printerMacAddress, settings?.printerName, markAsPrinted, updateSettings, addToBacklog]);

  // Auto-print new orders - returns true if print succeeded, false if failed
  const autoPrintOrder = useCallback(async (order: Order): Promise<boolean> => {
    if (!settings?.autoPrint) {
      console.log('[AutoPrint] Auto-print disabled');
      return false;
    }
    
    if (!settings?.printerMacAddress) {
      console.log('[AutoPrint] No printer configured - skipping auto-print');
      return false;
    }
    
    // CRITICAL: Check ACTUAL Bluetooth connection, not just stored setting
    const actuallyConnected = isPrinterConnected();
    if (!actuallyConnected) {
      console.log(`[AutoPrint] ⚠️ Printer not actually connected - adding to backlog`);
      addToBacklog(order.id);
      updateSettings({ printerConnected: false });
      return false;
    }
    
    // PREVENT DOUBLE PRINT: Check if already printing this order
    if (currentlyPrinting.current.has(order.id)) {
      console.log(`[AutoPrint] ⚠️ BLOCKED - Order #${order.order_number} is already being printed`);
      return false;
    }
    
    // Mark as currently printing BEFORE starting
    currentlyPrinting.current.add(order.id);
    console.log(`[AutoPrint] 🖨️ Auto-printing order #${order.order_number}...`);
    
    try {
      // Try to print - handlePrint will verify connection and print
      await handlePrint(order);
      
      // Check if it was actually printed (added to printedOrderIds)
      // Note: handlePrint only adds to printedOrderIds on success
      // We can't check here immediately due to async state, but handlePrint
      // handles all the success/failure logic internally
      return true;
    } catch (error) {
      console.error(`[AutoPrint] ❌ Failed to print order #${order.order_number}:`, error);
      // Print failed - add to backlog so user can retry
      addToBacklog(order.id);
      return false;
    } finally {
      // Remove from currently printing after done (success or fail)
      currentlyPrinting.current.delete(order.id);
    }
  }, [settings?.autoPrint, settings?.printerMacAddress, handlePrint, addToBacklog, updateSettings]);

  // AUTO-PRINT - Only prints NEW orders, NEVER reprints
  // Also tracks backlogged orders (arrived while printer offline)
  // ⚠️ CRITICAL SAFETY: Multiple layers of protection against infinite print loops
  useEffect(() => {
    // WAIT until all tracking data is loaded from storage
    if (!printedIdsLoaded || !backlogIdsLoaded || !printCountsLoaded) {
      console.log('[AutoPrint] Waiting for tracking data to load...');
      return;
    }
    
    // First load - mark all existing orders as known (don't print old orders)
    if (lastKnownOrderIds.current.size === 0 && ordersList.length > 0) {
      console.log(`[AutoPrint] Initial load - ${ordersList.length} existing orders marked as known`);
      lastKnownOrderIds.current = new Set(ordersList.map(o => o.id));
      return;
    }
    
    // Find NEW orders that just arrived:
    // 1. NOT already printed (check printedOrderIds first!)
    // 2. Not in known list (just arrived)
    // 3. Status is pending
    // 4. Created within MAX_AUTO_PRINT_AGE_MINUTES (safety limit for old orders)
    // 5. Print count hasn't exceeded MAX_PRINT_COUNT (prevents infinite loops)
    const maxAgeTime = new Date(Date.now() - MAX_AUTO_PRINT_AGE_MINUTES * 60 * 1000);
    
    const newOrders = ordersList.filter(order => {
      // SAFETY CHECK 1: Skip if already marked as printed
      if (printedOrderIds.has(order.id)) {
        return false;
      }
      
      // SAFETY CHECK 2: Skip if print count exceeds limit (prevents infinite loops!)
      const orderPrintCount = printCounts.get(order.id) || 0;
      if (orderPrintCount >= MAX_PRINT_COUNT) {
        console.warn(`[AutoPrint] ⛔ BLOCKED: Order ${order.id} already printed ${orderPrintCount} times (max: ${MAX_PRINT_COUNT})`);
        return false;
      }
      
      const isNewToSession = !lastKnownOrderIds.current.has(order.id);
      const isPending = order.status === 'pending';
      
      // SAFETY CHECK 3: Only print orders created within MAX_AUTO_PRINT_AGE_MINUTES
      const orderAge = new Date(order.created_at);
      const isRecentEnough = orderAge > maxAgeTime;
      
      // If order is too old, log a warning and add to backlog instead
      if (isNewToSession && isPending && !isRecentEnough) {
        console.warn(`[AutoPrint] ⚠️ Order #${order.order_number} is too old (${Math.round((Date.now() - orderAge.getTime()) / 60000)} min old) - adding to backlog`);
        if (!backloggedOrderIds.has(order.id)) {
          addToBacklog(order.id);
        }
        return false;
      }
      
      return isNewToSession && isPending && isRecentEnough;
    });
    
    if (newOrders.length > 0) {
      console.log(`[AutoPrint] 🆕 ${newOrders.length} NEW orders detected!`);
      Vibration.vibrate([0, 500, 200, 500]);
      
      // Check ACTUAL printer connection (not just stored setting)
      const actuallyConnected = isPrinterConnected();
      
      if (!actuallyConnected || !settings?.autoPrint) {
        // PRINTER OFFLINE: Add to backlog instead of printing
        console.log(`[Backlog] ⚠️ Printer ${actuallyConnected ? 'connected but auto-print off' : 'OFFLINE'} - adding ${newOrders.length} orders to backlog`);
        newOrders.forEach(order => {
          if (!backloggedOrderIds.has(order.id)) {
            addToBacklog(order.id);
          }
        });
        // Update stored state to reflect reality
        if (!actuallyConnected && printerConnected) {
          updateSettings({ printerConnected: false });
        }
        
        // IMMEDIATE ALERT: Sound + vibration when orders go to backlog!
        console.log(`[Backlog] 🚨 ALERTING: ${newOrders.length} new orders could NOT auto-print!`);
        playAlertSound();
        Vibration.vibrate([0, 800, 200, 800, 200, 800]);
      } else {
        // PRINTER ONLINE: Auto-print each order (but NOT backlogged ones!)
        newOrders.forEach((order, index) => {
          // Skip if this order is backlogged (came in while offline, needs manual review)
          if (backloggedOrderIds.has(order.id)) {
            console.log(`[AutoPrint] ⚠️ Skipping backlogged order #${order.order_number} - requires manual print`);
            return;
          }
          
          setTimeout(() => {
            // Double-check not printed and not backlogged before actually printing
            if (!printedOrderIds.has(order.id) && !backloggedOrderIds.has(order.id)) {
              autoPrintOrder(order);
            }
          }, index * 2000);
        });
      }
    }
    
    // Update known orders
    lastKnownOrderIds.current = new Set(ordersList.map(o => o.id));
  }, [ordersList, printedIdsLoaded, backlogIdsLoaded, printCountsLoaded, printedOrderIds, backloggedOrderIds, printCounts, settings?.autoPrint, printerConnected, autoPrintOrder, addToBacklog, updateSettings, playAlertSound]);

  // Track if we've shown the alert popup and played initial sound (don't spam)
  const alertPopupShown = useRef(false);
  const initialAlertPlayed = useRef(false);
  const lastUnprintedCount = useRef(0);
  const lastPrinterOkAt = useRef<number | null>(null);
  const printerAlerted = useRef(false);
  
  // SIMPLE ALERT: Any new-ish order that hasn't been printed = ALERT
  // Doesn't matter why it wasn't printed - just alert!
  useEffect(() => {
    // Find ALL new-ish orders that haven't been printed
    const unprintedPendingOrders = ordersList.filter(
      order =>
        (order.status === 'pending' ||
          order.status === 'confirmed' ||
          order.status === 'preparing') &&
        !printedOrderIds.has(order.id)
    );
    
    const currentCount = unprintedPendingOrders.length;
    // IMPORTANT: Default to TRUE if setting is undefined (defensive coding)
    const alertsEnabled = settings?.printerAlertsEnabled !== false;
    const soundEnabled = settings?.soundEnabled !== false;
    const canAlert = alertsEnabled && soundEnabled;
    
    console.log(`[ALERT-CHECK] Unprinted: ${currentCount}, AlertsEnabled: ${alertsEnabled}, Setting value: ${settings?.printerAlertsEnabled}`);
    
    // Only play IMMEDIATE alert if:
    // 1. Count increased (new unprinted order arrived)
    // 2. OR first time seeing unprinted orders this session
    const shouldPlayImmediate = currentCount > 0 && 
      (currentCount > lastUnprintedCount.current || !initialAlertPlayed.current);
    
    if (shouldPlayImmediate && canAlert) {
      console.log(`[ALERT] 🚨 NEW unprinted order! Count: ${currentCount}`);
      playAlertSound();
      Vibration.vibrate([0, 800, 200, 800, 200, 800]);
      initialAlertPlayed.current = true;
    }
    
    // Update the count tracker
    lastUnprintedCount.current = currentCount;
    
    // Clear existing interval
    if (backlogAlertInterval.current) {
      clearInterval(backlogAlertInterval.current);
      backlogAlertInterval.current = null;
    }
    
    if (currentCount > 0) {
      // Show popup ONCE per session - only if alerts enabled
      if (!alertPopupShown.current && canAlert) {
        alertPopupShown.current = true;
        
        // Different buttons based on printer connection status
        const hasPrinter = !!settings?.printerMacAddress;
        
        Alert.alert(
          '⚠️ Unprinted Orders!',
          hasPrinter 
            ? `You have ${currentCount} order(s) waiting to be printed.\n\nTap "Print Now" to print, or go to Settings to check printer connection.`
            : `You have ${currentCount} order(s) waiting to be printed.\n\nNo printer connected. Go to Settings to connect a printer.`,
          hasPrinter 
            ? [
                { text: 'OK', style: 'default' },
                { 
                  text: 'Print Now', 
                  style: 'default',
                  onPress: () => {
                    if (unprintedPendingOrders[0]) {
                      setSelectedOrderId(unprintedPendingOrders[0].id);
                    }
                  }
                }
              ]
            : [
                { text: 'OK', style: 'default' },
                { 
                  text: 'Connect Printer', 
                  style: 'default',
                  onPress: () => navigation.navigate('Settings' as never)
                }
              ]
        );
      }
      
      // Keep alerting every 60 seconds until handled (only if alerts enabled)
      if (canAlert) {
        backlogAlertInterval.current = setInterval(() => {
          console.log(`[ALERT] 🔔 REMINDER: ${currentCount} unprinted orders!`);
          playAlertSound();
          Vibration.vibrate([0, 800, 200, 800, 200, 800]);
        }, BACKLOG_ALERT_INTERVAL_MS);
      }
    } else {
      // No unprinted orders - reset flags for next time
      alertPopupShown.current = false;
      initialAlertPlayed.current = false;
    }
    
    if (!canAlert) {
      if (backlogAlertInterval.current) {
        clearInterval(backlogAlertInterval.current);
        backlogAlertInterval.current = null;
      }
      // Reset alert gating so re-enabling alerts will behave correctly
      alertPopupShown.current = false;
      initialAlertPlayed.current = false;
    }

    return () => {
      if (backlogAlertInterval.current) {
        clearInterval(backlogAlertInterval.current);
        backlogAlertInterval.current = null;
      }
    };
  }, [ordersList, printedOrderIds, playAlertSound, settings?.printerAlertsEnabled, settings?.soundEnabled, settings?.printerMacAddress, navigation]);

  // Intentionally do NOT auto-move printed orders to Active.
  // Orders stay in New until staff taps Accept, which also clears ring-until-accepted.

  // Clear selection when entering simplified view (cards should start collapsed)
  useEffect(() => {
    if (viewMode === 'two') {
      setSelectedOrderId(null);
    }
  }, [viewMode]);

  // Auto-select disabled - both views now use Kanban with cards that start collapsed
  // Users tap to expand whichever order they want to work with

  // Auto-reconnect to saved printer on app startup (runs once on mount)
  useEffect(() => {
    const autoReconnect = async () => {
      // Only attempt if we have a saved printer address
      if (!settings?.printerMacAddress) {
        console.log('[AutoReconnect] No printer configured - skipping auto-reconnect');
        return;
      }

      // Check if already connected
      const isCurrentlyConnected = await verifyConnection();
      if (isCurrentlyConnected) {
        console.log('[AutoReconnect] ✓ Already connected to printer');
        updateSettings({ printerConnected: true });
        return;
      }

      // Attempt to reconnect
      console.log(`[AutoReconnect] 🔄 Attempting to reconnect to ${settings.printerName || 'printer'} (${settings.printerMacAddress})...`);
      try {
        const success = await connectPrinter(settings.printerMacAddress);
        if (success) {
          console.log('[AutoReconnect] ✓ Successfully reconnected to printer!');
          updateSettings({ printerConnected: true });
        } else {
          console.log('[AutoReconnect] ⚠️ Reconnect failed - printer may be off or out of range');
          updateSettings({ printerConnected: false });
        }
      } catch (error) {
        console.error('[AutoReconnect] ✗ Reconnect error:', error);
        updateSettings({ printerConnected: false });
      }
    };
    
    // Small delay to let Bluetooth initialize (2 seconds)
    const timer = setTimeout(autoReconnect, 2000);
    return () => clearTimeout(timer);
  }, []); // Only run once on mount

  // Periodically VERIFY connection (runs every 15 seconds)
  // This actually tests if the printer responds, not just checking stored state
  useEffect(() => {
    const checkConnection = async () => {
      // Only verify if we have a stored printer address
      if (!settings?.printerMacAddress) {
        return;
      }

      const storedAsConnected = settings?.printerConnected;
      const now = Date.now();

      // CRITICAL: Actually verify the Bluetooth connection works
      console.log('[PrinterCheck] 🔍 Verifying actual printer connection...');
      const actuallyWorking = await verifyConnection();
      
      console.log(`[PrinterCheck] Result - stored: ${storedAsConnected}, actuallyWorking: ${actuallyWorking}`);

      if (actuallyWorking) {
        lastPrinterOkAt.current = now;
        printerAlerted.current = false;

        if (!storedAsConnected) {
          // Printer just came back online! Alert user
          console.log('[PrinterCheck] 🎉 Printer is back ONLINE!');
          updateSettings({ printerConnected: true });
          
          // Play happy alert and show notification
          if (settings?.printerAlertsEnabled !== false) {
            Vibration.vibrate([0, 200, 100, 200]); // Short happy vibration
            Alert.alert(
              '🖨️ Printer Connected!',
              'Your printer is back online and ready to print.',
              [{ text: 'Great!', style: 'default' }]
            );
          }
        } else {
          console.log('[PrinterCheck] ✓ Printer connected and verified');
        }
        return;
      }

      // Not working: only alert after sustained outage
      if (lastPrinterOkAt.current === null) {
        lastPrinterOkAt.current = now;
      }
      const downMs = now - lastPrinterOkAt.current;
      if (downMs < PRINTER_DISCONNECT_ALERT_MS) {
        console.log(`[PrinterCheck] ⚠️ Printer not responding (${Math.round(downMs / 1000)}s) - waiting before alert`);
        return;
      }

      // Sustained outage: mark as disconnected and alert once
      if (storedAsConnected) {
        console.log('[PrinterCheck] ❌ Printer not responding - marking as DISCONNECTED');
        updateSettings({ printerConnected: false });
      }

      if (storedAsConnected && settings?.printerAlertsEnabled !== false && !printerAlerted.current) {
        console.log('[PrinterCheck] ⚠️ Printer offline > 2 minutes! Playing alert...');
        Vibration.vibrate([0, 800, 200, 800, 200, 800]);
        playAlertSound();
        printerAlerted.current = true;
      }
    };
    
    // Initial verification after a short delay (let auto-reconnect happen first)
    const initialTimer = setTimeout(checkConnection, 5000);
    
    // Periodic connection verification
    const interval = setInterval(checkConnection, PRINTER_VERIFY_INTERVAL_MS);
    
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [settings?.printerMacAddress, settings?.printerName, settings?.printerConnected, settings?.printerAlertsEnabled, updateSettings, playAlertSound]);

  const runConnectionRecovery = useCallback(
    async (reason: string, showSuccessAlert = false) => {
      const now = Date.now();
      if (!showSuccessAlert && now - lastRecoveryAttemptAt.current < WATCHDOG_RECOVERY_COOLDOWN_MS) {
        return;
      }
      if (!offline.isOnline) {
        console.warn(`[Watchdog] Recovery skipped while offline (${reason})`);
        if (showSuccessAlert) {
          Alert.alert('Tablet Offline', 'Cannot recover while offline. Check Wi-Fi and internet first.');
        }
        return;
      }

      lastRecoveryAttemptAt.current = now;
      console.warn(`[Watchdog] Running recovery (${reason})`);

      try {
        await checkAuth();
        await fetchOrders();
        setHealthNow(Date.now());

        if (showSuccessAlert) {
          const latestFetch = useStore.getState().orders.lastFetchTime;
          const message = latestFetch
            ? `Orders re-synced at ${new Date(latestFetch).toLocaleTimeString()}.`
            : 'Recovery completed. Please confirm orders are updating.';
          Alert.alert('Recovery Complete', message);
        }
      } catch (error) {
        console.error('[Watchdog] Recovery failed:', error);
        if (showSuccessAlert) {
          Alert.alert('Recovery Failed', 'Could not re-sync orders. Check network and try again.');
        }
      }
    },
    [checkAuth, fetchOrders, offline.isOnline]
  );

  const handleManualRecovery = useCallback(() => {
    void runConnectionRecovery('manual', true);
  }, [runConnectionRecovery]);

  // Watchdog: detect stale order sync and self-heal before stale orders become a customer issue.
  useEffect(() => {
    const tick = async () => {
      const now = Date.now();
      setHealthNow(now);

      const state = useStore.getState();
      if (!state.auth.isAuthenticated) {
        return;
      }

      const lastFetchMs = state.orders.lastFetchTime
        ? new Date(state.orders.lastFetchTime).getTime()
        : null;
      const staleMs = lastFetchMs ? Math.max(0, now - lastFetchMs) : null;
      const failures = state.orders.consecutiveFetchFailures || 0;

      if (failures >= 3 || (!!staleMs && staleMs >= WATCHDOG_STALE_WARNING_MS)) {
        await runConnectionRecovery(
          failures >= 3
            ? `consecutive failures (${failures})`
            : `stale sync ${Math.round((staleMs || 0) / 1000)}s`
        );
      }
    };

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, WATCHDOG_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [runConnectionRecovery]);

  // Polling
  useFocusEffect(
    useCallback(() => {
      fetchOrders();

      pollIntervalRef.current = setInterval(() => {
          fetchOrders();
      }, settings?.pollIntervalMs || 5000);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }, [fetchOrders, settings?.pollIntervalMs])
  );

  // Reset filter when switching between simplified and standard view
  useEffect(() => {
    if (viewMode === 'two') {
      setActiveFilter('simplified_new');
    } else {
      setActiveFilter('new');
    }
  }, [viewMode]);

  // Refresh handler
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await checkAuth();
    await fetchOrders();
    setHealthNow(Date.now());
    setRefreshing(false);
  }, [checkAuth, fetchOrders]);

  // Status change handler
  const handleStatusChange = useCallback(async (orderId: string, status: string) => {
    try {
      await updateOrderStatus(orderId, status as OrderStatus);
    } catch (error) {
      console.error('[StatusChange] Error:', error);
      Alert.alert('Error', 'Failed to update order status');
    }
  }, [updateOrderStatus]);

  const handleAcceptOrder = useCallback(async (orderId: string) => {
    try {
      await acknowledgeOrder(orderId);
    } catch (error) {
      console.error('[Accept] Error:', error);
    }
  }, [acknowledgeOrder]);

  // Kanban status change via tablet API endpoint (supports compatibility transitions)
  const handleKanbanStatusChange = useCallback(async (orderId: string, targetStatus: string) => {
    // Read fresh state directly from store (avoids stale closure on rapid drags)
    const freshOrders = useStore.getState().orders.orders;
    const targetOrder = freshOrders.find(o => o.id === orderId);
    const previousStatus = targetOrder?.status;

    if (!targetOrder) {
      console.error(`[KanbanStatusChange] Order not found in local state: ${orderId}`);
      Alert.alert('Error', 'Could not identify order. Please refresh and try again.');
      return;
    }
    
    // Optimistic update - immediately move the order to new column
    // Set updated_at to now so it appears at the top of the destination column
    const updatedOrders = freshOrders.map(order => 
      order.id === orderId 
        ? { ...order, status: targetStatus as OrderStatus, updated_at: new Date().toISOString() } 
        : order
    );
    setOrders({ orders: updatedOrders });

    try {
      const fallbackOrderId =
        targetOrder.numeric_id && targetOrder.numeric_id > 0
          ? String(targetOrder.numeric_id)
          : null;

      const runStatusUpdate = async (nextStatus: OrderStatus) => {
        let result = await apiClient.updateOrderStatus(orderId, nextStatus);
        const shouldRetryWithNumericId =
          !result.success &&
          !!fallbackOrderId &&
          fallbackOrderId !== orderId &&
          (result.error?.includes('Order not found') ||
            result.error?.includes('not found') ||
            result.error?.includes('Invalid order ID'));

        if (shouldRetryWithNumericId) {
          console.warn(
            `[KanbanStatusChange] Primary ID failed for ${orderId}; retrying with numeric_id ${fallbackOrderId}`
          );
          result = await apiClient.updateOrderStatus(fallbackOrderId!, nextStatus);
        }
        return result;
      };

      const statusSequence: OrderStatus[] =
        previousStatus === 'ready' && targetStatus === 'preparing'
          ? ['pending', 'preparing']
          : [targetStatus as OrderStatus];

      let lastSuccessfulStatus: OrderStatus | null = null;
      let result: { success: boolean; error?: string } = { success: true };
      for (const nextStatus of statusSequence) {
        result = await runStatusUpdate(nextStatus);
        if (!result.success) break;
        lastSuccessfulStatus = nextStatus;
      }
      
      if (!result.success) {
        // Check if the order was deleted from the database
        if (result.error?.includes('Order not found') || result.error?.includes('not found')) {
          console.warn(`[KanbanStatusChange] ⚠️ Order ${orderId} no longer exists - removing from local state`);
          const currentOrders = useStore.getState().orders.orders;
          setOrders({ orders: currentOrders.filter(o => o.id !== orderId) });
          if (selectedOrderId === orderId) setSelectedOrderId(null);
          Alert.alert('Order Removed', 'This order no longer exists and has been removed from the list.');
        } else {
          // Revert to last known-good local status (or previous status if nothing succeeded)
          const fallbackStatus = lastSuccessfulStatus || previousStatus;
          const currentOrders = useStore.getState().orders.orders;
          const revertedOrders = currentOrders.map(order =>
            order.id === orderId && fallbackStatus
              ? { ...order, status: fallbackStatus }
              : order
          );
          setOrders({ orders: revertedOrders });
          Alert.alert('Status Update Failed', result.error || 'Unknown error');
        }
      }
      // On success: trust the optimistic update, normal polling will sync
    } catch (error) {
      // Revert just this one order back to its previous status
      const currentOrders = useStore.getState().orders.orders;
      const revertedOrders = currentOrders.map(order =>
        order.id === orderId && previousStatus
          ? { ...order, status: previousStatus }
          : order
      );
      setOrders({ orders: revertedOrders });
      console.error('[KanbanStatusChange] Error:', error);
      Alert.alert('Error', 'Failed to update order status');
    }
  }, [setOrders]);

  // Mark as printed callback (used by detail panel)
  const handlePrinted = useCallback((orderId: string) => {
    markAsPrinted(orderId);
  }, [markAsPrinted]);
  
  // Handle printing all backlogged orders
  const handlePrintBackloggedOrders = useCallback(async () => {
    if (!settings?.printerMacAddress) {
      Alert.alert(
        'No Printer Connected', 
        'You need to connect a printer before printing orders.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Connect Printer', onPress: () => navigation.navigate('Settings' as never) }
        ]
      );
      return;
    }
    
    const backloggedOrders = ordersList.filter(
      o => backloggedOrderIds.has(o.id) && o.status === 'pending'
    );
    
    if (backloggedOrders.length === 0) {
      Alert.alert('No Backlogged Orders', 'There are no backlogged orders to print.');
      return;
    }
    
    Alert.alert(
      '⚠️ Print Backlogged Orders',
      `You have ${backloggedOrders.length} order(s) that arrived while the printer was offline.\n\nThese orders may be old. Review before printing to kitchen.\n\nPrint all ${backloggedOrders.length} order(s) now?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Review Individually', 
          onPress: () => {
            // Just switch to New filter so user can see and print one by one
            setActiveFilter('new');
          }
        },
        { 
          text: `Print All (${backloggedOrders.length})`, 
          style: 'destructive',
          onPress: async () => {
            console.log(`[Backlog] 🖨️ Printing ${backloggedOrders.length} backlogged orders...`);
            
            for (let i = 0; i < backloggedOrders.length; i++) {
              const order = backloggedOrders[i];
              try {
                await handlePrint(order);
                // Small delay between prints
                await new Promise(resolve => setTimeout(resolve, 1500));
              } catch (error) {
                console.error(`[Backlog] ❌ Failed to print order #${order.order_number}:`, error);
              }
            }
            
            console.log('[Backlog] ✓ Finished printing backlogged orders');
          }
        }
      ]
    );
  }, [printerConnected, ordersList, backloggedOrderIds, handlePrint]);

  // Filter orders
  const getFilteredOrders = useCallback(() => {
    switch (activeFilter) {
      case 'new':
        return ordersList.filter(o => o.status === 'pending');
      case 'active':
        return ordersList.filter(o => o.status === 'preparing' || o.status === 'confirmed');
      case 'ready':
        return ordersList.filter(o => o.status === 'ready');
      case 'completed':
        return ordersList.filter(o => o.status === 'completed' || o.status === 'cancelled');
      // Simplified view filters
      case 'simplified_new':
        return ordersList.filter(o => 
          o.status === 'pending' || o.status === 'confirmed' || o.status === 'preparing'
        );
      case 'simplified_ready':
        return ordersList.filter(o => 
          o.status === 'ready' || o.status === 'completed' || o.status === 'cancelled'
        );
      default:
        return ordersList;
    }
  }, [ordersList, activeFilter]);

  const filteredOrders = getFilteredOrders();

  // Count orders by status
  const counts = {
    all: ordersList.length,
    new: ordersList.filter(o => o.status === 'pending').length,
    active: ordersList.filter(o => o.status === 'preparing' || o.status === 'confirmed').length,
    ready: ordersList.filter(o => o.status === 'ready').length,
    completed: ordersList.filter(o => o.status === 'completed' || o.status === 'cancelled').length,
    // Simplified view counts
    simplified_new: ordersList.filter(o => 
      o.status === 'pending' || o.status === 'confirmed' || o.status === 'preparing'
    ).length,
    simplified_ready: ordersList.filter(o => 
      o.status === 'ready' || o.status === 'completed' || o.status === 'cancelled'
    ).length,
  };
  
  // Count backlogged orders (pending + in backlog)
  const backloggedCount = ordersList.filter(
    o => backloggedOrderIds.has(o.id) && o.status === 'pending'
  ).length;

  const twoColNewOrders = ordersList.filter(
    o => o.status === 'pending' || o.status === 'confirmed' || o.status === 'preparing'
  );
  const threeColNewOrders = ordersList.filter(o => o.status === 'pending');
  const threeColActiveOrders = ordersList.filter(o => o.status === 'confirmed' || o.status === 'preparing');
  const fourColNewOrders = ordersList.filter(o => o.status === 'pending');
  const fourColActiveOrders = ordersList.filter(o => o.status === 'confirmed' || o.status === 'preparing');
  const fourColReadyOrders = ordersList.filter(o => o.status === 'ready');

  const archivedCompleteCount = viewMode === 'four' ? completedOnlyArchived.length : completedOrdersArchived.length;
  const displayedCompleteCount = viewMode === 'four'
    ? (recallMode ? completedOnlyArchived.length : completedOnlyVisible.length)
    : (recallMode ? completedOrdersArchived.length : completedOrdersVisible.length);

  const dockCounts: { new: number; active?: number; ready?: number; complete: number } =
    viewMode === 'two'
      ? { new: twoColNewOrders.length, complete: displayedCompleteCount }
      : viewMode === 'four'
        ? {
            new: fourColNewOrders.length,
            active: fourColActiveOrders.length,
            ready: fourColReadyOrders.length,
            complete: displayedCompleteCount,
          }
        : {
            new: threeColNewOrders.length,
            active: threeColActiveOrders.length,
            complete: displayedCompleteCount,
          };

  useEffect(() => {
    setRecallMode(false);
  }, [viewMode]);

  useEffect(() => {
    if (recallMode && archivedCompleteCount === 0) {
      setRecallMode(false);
    }
  }, [recallMode, archivedCompleteCount]);

  useEffect(() => {
    setLocationLogoUrl(auth?.restaurantLogoUrl ?? null);
  }, [auth?.restaurantLogoUrl]);

  // Top spacing to separate from Samsung status bar
  const topPadding = Math.max(insets.top, 8);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Spacer bar to separate from Samsung status bar */}
      <View style={[styles.statusBarSpacer, { height: topPadding, backgroundColor: themeMode === 'dark' ? '#0a0f1a' : '#f1f5f9' }]} />

      {/* ORDER SYNC WATCHDOG BANNER */}
      {shouldShowStaleBanner && (
        <TouchableOpacity
          style={styles.connectionStaleBanner}
          onPress={handleManualRecovery}
          activeOpacity={0.8}
        >
          <View style={styles.backlogBannerContent}>
            <Text style={styles.backlogBannerIcon}>📡</Text>
            <View style={styles.backlogBannerText}>
              <Text style={styles.connectionStaleTitle}>Order Sync Delayed</Text>
              <Text style={styles.backlogBannerSubtitle}>
                {offline.isOnline
                  ? `Last successful sync ${formatElapsedTime(staleFetchMs || 0)} ago • Failures: ${consecutiveFetchFailures}`
                  : 'Tablet appears offline • Check Wi-Fi and internet connection'}
              </Text>
            </View>
            <Text style={styles.connectionStaleAction}>RECOVER</Text>
          </View>
        </TouchableOpacity>
      )}
      
      {/* PRINTER OFFLINE BANNER - Shows when printer is configured but disconnected */}
      {settings?.printerMacAddress && !printerConnected && (
        <TouchableOpacity 
          style={styles.printerOfflineBanner}
          onPress={() => navigation.navigate('Settings' as never)}
          activeOpacity={0.8}
        >
          <View style={styles.backlogBannerContent}>
            <Text style={styles.backlogBannerIcon}>🔌</Text>
            <View style={styles.backlogBannerText}>
              <Text style={styles.printerOfflineTitle}>Printer Offline</Text>
              <Text style={styles.backlogBannerSubtitle}>
                Check printer power & Bluetooth • Tap to reconnect
              </Text>
            </View>
            <Text style={styles.printerOfflineAction}>CONNECT</Text>
          </View>
        </TouchableOpacity>
      )}
      
      {/* BACKLOG WARNING BANNER */}
      {backloggedCount > 0 && (
        <TouchableOpacity 
          style={styles.backlogBanner}
          onPress={() => {
            if (settings?.printerMacAddress) {
              handlePrintBackloggedOrders();
            } else {
              navigation.navigate('Settings' as never);
            }
          }}
          activeOpacity={0.8}
        >
          <View style={styles.backlogBannerContent}>
            <Text style={styles.backlogBannerIcon}>⚠️</Text>
            <View style={styles.backlogBannerText}>
              <Text style={styles.backlogBannerTitle}>
                {backloggedCount} Order{backloggedCount > 1 ? 's' : ''} Waiting
              </Text>
              <Text style={styles.backlogBannerSubtitle}>
                {settings?.printerMacAddress 
                  ? 'Tap to review and print • These orders need attention'
                  : 'No printer connected • Tap to connect in Settings'}
              </Text>
            </View>
            <Text style={styles.backlogBannerAction}>
              {settings?.printerMacAddress ? 'PRINT' : 'CONNECT'}
            </Text>
          </View>
        </TouchableOpacity>
      )}
      
      {/* Main Content */}
      <View style={styles.content}>
        {simplifiedView ? (
          /* Kanban Board for Simplified View */
          <KanbanBoard
            showColumnHeaders={false}
            recallMode={recallMode}
            newOrders={twoColNewOrders}
            completeOrders={completedOrdersVisible}
            archivedCompleteOrders={completedOrdersArchived}
            selectedOrderId={selectedOrderId}
            onMoveToComplete={(orderId) => handleKanbanStatusChange(orderId, 'ready')}
            onMoveToNew={(orderId) => handleKanbanStatusChange(orderId, 'pending')}
            onOrderSelect={(orderId) => setSelectedOrderId(orderId)}
            onAccept={handleAcceptOrder}
            onPrint={handlePrint}
            onRefresh={handleRefresh}
            refreshing={refreshing}
          />
        ) : threeColumnView ? (
          /* 3-Column Kanban Board */
          <KanbanBoard3Col
            showColumnHeaders={false}
            recallMode={recallMode}
            newOrders={threeColNewOrders}
            activeOrders={threeColActiveOrders}
            completeOrders={completedOrdersVisible}
            archivedCompleteOrders={completedOrdersArchived}
            selectedOrderId={selectedOrderId}
            onStatusChange={handleKanbanStatusChange}
            onOrderSelect={(orderId) => setSelectedOrderId(orderId)}
            onAccept={handleAcceptOrder}
            onPrint={handlePrint}
            onRefresh={handleRefresh}
            refreshing={refreshing}
          />
        ) : (
          /* 4-Column Kanban Board for Regular View */
          <KanbanBoard4Col
            showColumnHeaders={false}
            recallMode={recallMode}
            newOrders={fourColNewOrders}
            activeOrders={fourColActiveOrders}
            readyOrders={fourColReadyOrders}
            completeOrders={completedOnlyVisible}
            archivedCompleteOrders={completedOnlyArchived}
            selectedOrderId={selectedOrderId}
            onStatusChange={handleKanbanStatusChange}
            onOrderSelect={(orderId) => setSelectedOrderId(orderId)}
            onAccept={handleAcceptOrder}
            onPrint={handlePrint}
            onRefresh={handleRefresh}
            refreshing={refreshing}
          />
        )}
      </View>

      <OrdersBottomDock
        restaurantName={auth?.restaurantName || 'Kitchen Printer'}
        locationLogoUrl={locationLogoUrl}
        viewMode={viewMode}
        counts={dockCounts}
        isOnline={offline.isOnline}
        printerConnected={printerConnected}
        onOpenSettings={() => navigation.navigate('Settings' as never)}
        onRefresh={handleRefresh}
        recall={{
          enabled: archivedCompleteCount > 0,
          archivedCount: archivedCompleteCount,
          active: recallMode,
          onToggle: () => setRecallMode(prev => !prev),
        }}
      />

      {/* Detail Panel removed - both views now use expandable cards */}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  statusBarSpacer: {
    width: '100%',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
  },
  listColumn: {
    flex: 55,  // 55% when order selected
    borderRightWidth: 1,
    paddingTop: 0,
  },
  listColumnFull: {
    flex: 1,  // Full width when no order selected
    borderRightWidth: 0,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  tableHeaderText: {
    fontSize: 13,
    fontWeight: '500',
  },
  customerCol: {
    minWidth: 120,
    maxWidth: 240,
    marginRight: 30,
  },
  typeCol: {
    width: 100,
    marginRight: 30,
  },
  printedCol: {
    width: 85,
    textAlign: 'center',
    marginRight: 20,
  },
  timeCol: {
    width: 100,
    textAlign: 'right',
  },
  listContent: {
    paddingBottom: 20,
  },
  detailOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '45%',  // 45% of screen as overlay
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 15,
    zIndex: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
  },
  // Backlog warning banner styles
  connectionStaleBanner: {
    backgroundColor: '#b45309',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  connectionStaleTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  connectionStaleAction: {
    backgroundColor: '#ffffff',
    color: '#b45309',
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  backlogBanner: {
    backgroundColor: '#dc2626',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  backlogBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backlogBannerIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  backlogBannerText: {
    flex: 1,
  },
  backlogBannerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  backlogBannerSubtitle: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 13,
    marginTop: 2,
  },
  backlogBannerAction: {
    backgroundColor: '#ffffff',
    color: '#dc2626',
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  // Printer offline banner styles
  printerOfflineBanner: {
    backgroundColor: '#7c3aed', // Purple to differentiate from red backlog banner
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  printerOfflineTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  printerOfflineAction: {
    backgroundColor: '#ffffff',
    color: '#7c3aed',
    fontSize: 13,
    fontWeight: '800',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    overflow: 'hidden',
  },
});

export default OrdersListScreen;
