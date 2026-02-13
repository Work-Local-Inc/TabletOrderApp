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
  Image,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
// import { Audio } from 'expo-av'; // Temporarily disabled
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useStore } from '../store/useStore';
import { useOrderNotifications } from '../hooks';
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
import { OrderListItem, OrderDetailPanel, OrderFilters, FilterStatus, KanbanBoard } from '../components/orders';
import { KanbanBoard4Col } from '../components/orders/KanbanBoard4Col';
import { KanbanBoard3Col } from '../components/orders/KanbanBoard3Col';
import { useTheme } from '../theme';
import { tabletUpdateOrderStatus } from '../api/supabaseRpc';
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

export const OrdersListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { theme, themeMode } = useTheme();
  const insets = useSafeAreaInsets();
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastKnownOrderIds = useRef<Set<string>>(new Set());
  // Enable new-order notifications + ring-until-accepted logic
  useOrderNotifications();
  
  // NOTE: Heartbeat removed - already running at app root (App.tsx)
  // Having it here caused duplicate heartbeats (2x network, 2x battery drain)
  
  // Local state
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterStatus>('new');
  const [refreshing, setRefreshing] = useState(false);
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);
  
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
      await playAlert();
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
    acknowledgeOrder,
    updateOrderStatus,
    settings,
    updateSettings,
    auth,
  } = useStore();

  const printerConnected = settings?.printerConnected ?? false;
  const viewMode = settings?.viewMode ?? 'three';
  const simplifiedView = viewMode === 'two';
  const threeColumnView = viewMode === 'three';
  const ordersList = orders?.orders || [];
  const completedArchiveLimit = Math.max(1, settings?.completedArchiveLimit ?? 50);

  const completedOrdersBase = ordersList
    .filter(o => o.status === 'ready' || o.status === 'completed' || o.status === 'cancelled')
    .sort((a, b) => {
      const aTime = new Date(a.updated_at || a.created_at).getTime();
      const bTime = new Date(b.updated_at || b.created_at).getTime();
      return bTime - aTime;
    });

  const completedOrdersVisible = completedOrdersBase.slice(0, completedArchiveLimit);
  const completedOrdersArchived = completedOrdersBase.slice(completedArchiveLimit);

  const completedOnlyBase = ordersList
    .filter(o => o.status === 'completed' || o.status === 'cancelled')
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
    // Check if printer is supposedly connected (from settings)
    if (!printerConnected) {
      Alert.alert('Printer Not Connected', 'Please connect a printer in Settings first.');
      return;
    }

    setPrintingOrderId(order.id);
    try {
      // CRITICAL: Verify the ACTUAL Bluetooth connection before printing
      const macAddress = settings?.printerMacAddress;
      if (!macAddress) {
        Alert.alert('No Printer Configured', 'Please connect a printer in Settings first.');
        setPrintingOrderId(null);
        return;
      }

      // Ensure we have an active connection
      console.log(`[Print] 🔗 Verifying connection to ${settings?.printerName}...`);
      const isConnected = await ensureConnected(macAddress);
      
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
        
        // Move to Active (preparing) status
        if (order.status === 'pending') {
          console.log(`[Print] ✓ Moving order #${order.order_number} to Active...`);
          try {
            // Don't await - fire and forget, we already did optimistic update
            updateOrderStatus(order.id, 'preparing')
              .then(result => {
                if (result) {
                  console.log(`[Print] ✓ Backend confirmed: Order #${order.order_number} is Active`);
                } else {
                  console.warn(`[Print] ⚠️ Backend update failed for order #${order.order_number} - will sync on next fetch`);
                }
              })
              .catch(err => {
                console.warn(`[Print] ⚠️ Backend update error for order #${order.order_number}:`, err);
              });
            
            // Show success immediately - don't wait for backend
            Alert.alert('✓ Printed', `Order #${order.order_number} printed successfully`);
          } catch (err: any) {
            console.error('[Print] Failed to update status:', err);
            // Still show success since print worked
            Alert.alert('✓ Printed', `Order #${order.order_number} printed successfully`);
          }
        } else {
          Alert.alert('✓ Printed', `Order #${order.order_number} printed successfully`);
        }
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
  }, [printerConnected, settings?.defaultPrintType, settings?.printerMacAddress, settings?.printerName, markAsPrinted, updateOrderStatus, updateSettings, addToBacklog]);

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

  // Sync printed orders to Active status on load
  // Direct: pending → preparing (backend now allows this)
  useEffect(() => {
    // Wait for printed IDs to load
    if (!printedIdsLoaded) return;
    
    const syncPrintedOrdersToActive = async () => {
      console.log(`[Sync] Checking ${ordersList.length} orders, ${printedOrderIds.size} printed IDs`);
      
      const printedButPending = ordersList.filter(
        order => printedOrderIds.has(order.id) && order.status === 'pending'
      );
      
      if (printedButPending.length > 0) {
        console.log(`[Sync] 🔄 Moving ${printedButPending.length} printed orders to Active...`);
        for (const order of printedButPending) {
          try {
            console.log(`[Sync] → Order #${order.order_number} to preparing...`);
            await updateOrderStatus(order.id, 'preparing');
            console.log(`[Sync] ✓ Done`);
          } catch (err) {
            console.error(`[Sync] ✗ Failed:`, err);
          }
        }
        // Refresh after sync
        setTimeout(() => fetchOrders(), 500);
      }
    };
    
    if (ordersList.length > 0 && printedOrderIds.size > 0) {
      syncPrintedOrdersToActive();
    }
  }, [ordersList.length, printedIdsLoaded, printedOrderIds, updateOrderStatus, fetchOrders]);

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
    await fetchOrders();
    setRefreshing(false);
  }, [fetchOrders]);

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

  // Kanban status change - uses direct Supabase call for flexible transitions
  const handleKanbanStatusChange = useCallback(async (orderId: string, targetStatus: string) => {
    // Read fresh state directly from store (avoids stale closure on rapid drags)
    const freshOrders = useStore.getState().orders.orders;
    const targetOrder = freshOrders.find(o => o.id === orderId);
    const previousStatus = targetOrder?.status;
    const numericId = targetOrder?.numeric_id;
    
    if (!numericId) {
      console.error(`[KanbanStatusChange] No numeric_id found for order ${orderId}`);
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
      // Use direct Supabase RPC call - bypasses PHP backend restrictions
      const result = await tabletUpdateOrderStatus(numericId, targetStatus);
      
      if (!result.success) {
        // Check if the order was deleted from the database
        if (result.error?.includes('Order not found') || result.error?.includes('not found')) {
          console.warn(`[KanbanStatusChange] ⚠️ Order ${orderId} no longer exists - removing from local state`);
          const currentOrders = useStore.getState().orders.orders;
          setOrders({ orders: currentOrders.filter(o => o.id !== orderId) });
          if (selectedOrderId === orderId) setSelectedOrderId(null);
          Alert.alert('Order Removed', 'This order no longer exists and has been removed from the list.');
        } else {
          // Revert just this one order back to its previous status
          const currentOrders = useStore.getState().orders.orders;
          const revertedOrders = currentOrders.map(order =>
            order.id === orderId && previousStatus
              ? { ...order, status: previousStatus }
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

  // Dynamic styles based on theme
  const dynamicStyles = {
    container: { backgroundColor: theme.background },
    header: { 
      backgroundColor: themeMode === 'dark' ? '#0f172a' : '#ffffff',
      borderBottomColor: themeMode === 'dark' ? '#1e293b' : '#e2e8f0',
    },
    headerText: { color: theme.text },
    headerSubtext: { color: theme.textSecondary },
    listColumn: { backgroundColor: theme.surface, borderRightColor: theme.cardBorder },
    detailColumn: { backgroundColor: themeMode === 'dark' ? '#1a1a2e' : '#ffffff' },
    printerBadge: { backgroundColor: printerConnected ? '#22c55e' : '#ef4444' },
  };

  // Top spacing to separate from Samsung status bar
  const topPadding = Math.max(insets.top, 8);

  return (
    <View style={[styles.container, dynamicStyles.container]}>
      {/* Spacer bar to separate from Samsung status bar */}
      <View style={[styles.statusBarSpacer, { height: topPadding, backgroundColor: themeMode === 'dark' ? '#0a0f1a' : '#f1f5f9' }]} />
      
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
      
      {/* Header - Single Horizontal Line */}
      <View style={[styles.header, dynamicStyles.header]}>
        <View style={styles.logoContainer}>
          <Image 
            source={require('../../assets/logo.png')} 
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
        <Text style={[styles.headerTitle, dynamicStyles.headerText]}>
          {auth?.restaurantName || 'Kitchen Printer'}
        </Text>
        <View style={[styles.printerBadge, dynamicStyles.printerBadge]}>
          <Text style={styles.printerBadgeText}>
            {printerConnected ? '🖨️ Connected' : '⚠️ No Printer'}
          </Text>
            </View>
        <View style={styles.headerSpacer} />
          <TouchableOpacity
          style={[styles.settingsButton, { backgroundColor: theme.surface }]}
            onPress={() => navigation.navigate('Settings')}
            testID="orders-settings-button"
            nativeID="orders-settings-button"
          >
            <Ionicons name="settings-outline" size={24} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>

      {/* Main Content */}
      <View style={styles.content}>
        {simplifiedView ? (
          /* Kanban Board for Simplified View */
          <KanbanBoard
            newOrders={ordersList.filter(o => 
              o.status === 'pending' || o.status === 'confirmed' || o.status === 'preparing'
            )}
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
            newOrders={ordersList.filter(o => o.status === 'pending')}
            activeOrders={ordersList.filter(o => o.status === 'confirmed' || o.status === 'preparing')}
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
            newOrders={ordersList.filter(o => o.status === 'pending')}
            activeOrders={ordersList.filter(o => o.status === 'confirmed' || o.status === 'preparing')}
            readyOrders={ordersList.filter(o => o.status === 'ready')}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 0,
    gap: 16,
  },
  logoContainer: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },
  logo: {
    width: 70,
    height: 28,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  printerBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  printerBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  headerSpacer: {
    flex: 1,
  },
  settingsButton: {
    padding: 10,
    borderRadius: 10,
  },
  settingsIcon: {
    fontSize: 24,
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
