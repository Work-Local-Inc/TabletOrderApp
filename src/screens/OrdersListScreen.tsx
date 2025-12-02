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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
} from '../services/printService';
import { OrderListItem, OrderDetailPanel, OrderFilters, FilterStatus } from '../components/orders';
import { useTheme } from '../theme';
import { useHeartbeat } from '../hooks';

type RootStackParamList = {
  Orders: undefined;
  OrderDetail: { orderId: string };
  Settings: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Orders'>;
type PrintType = 'kitchen' | 'receipt' | 'both';

// Storage key for printed orders
const PRINTED_ORDERS_KEY = '@printed_order_ids';

export const OrdersListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { theme, themeMode } = useTheme();
  const insets = useSafeAreaInsets();
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastKnownOrderIds = useRef<Set<string>>(new Set());
  
  // Start heartbeat to keep device online in dashboard
  useHeartbeat();
  
  // Local state
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterStatus>('new');
  const [refreshing, setRefreshing] = useState(false);
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);
  
  // PRINTED ORDER TRACKING - React state so we properly wait for it to load
  const [printedOrderIds, setPrintedOrderIds] = useState<Set<string>>(new Set());
  const [printedIdsLoaded, setPrintedIdsLoaded] = useState(false);
  
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
  
  // Save printed IDs whenever they change
  const savePrintedIds = useCallback(async (ids: Set<string>) => {
    try {
      await AsyncStorage.setItem(PRINTED_ORDERS_KEY, JSON.stringify([...ids]));
      console.log(`[PrintQueue] ✓ Saved ${ids.size} printed IDs`);
    } catch (error) {
      console.error('[PrintQueue] Error saving:', error);
    }
  }, []);
  
  // Mark order as printed
  const markAsPrinted = useCallback((orderId: string) => {
    setPrintedOrderIds(prev => {
      const newSet = new Set(prev);
      newSet.add(orderId);
      savePrintedIds(newSet);
      console.log(`[PrintQueue] 🖨️ Marked ${orderId} as printed`);
      return newSet;
    });
  }, [savePrintedIds]);
  
  // Check if order was printed
  const wasPrinted = useCallback((orderId: string): boolean => {
    return printedOrderIds.has(orderId);
  }, [printedOrderIds]);

  // Store state
  const {
    orders,
    fetchOrders,
    updateOrderStatus,
    settings,
    updateSettings,
    auth,
  } = useStore();

  const printerConnected = settings?.printerConnected ?? false;
  const ordersList = orders?.orders || [];
  
  // Find selected order
  const selectedOrder = selectedOrderId 
    ? ordersList.find(o => o.id === selectedOrderId) || null
    : null;

  // Print function - ONLY marks as printed if print ACTUALLY succeeds
  const handlePrint = useCallback(async (order: Order) => {
    console.log(`[Print] 🖨️ Starting print for order #${order.order_number}...`);
    
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
            const statusResult = await updateOrderStatus(order.id, 'preparing');
            if (statusResult) {
              console.log(`[Print] ✓ Order #${order.order_number} is now Active`);
              Alert.alert('✓ Printed & Active', `Order #${order.order_number} printed and moved to Active`);
            } else {
              Alert.alert('⚠️ Printed but Status Failed', `Order printed but couldn't update status.\nOrder ID: ${order.id}`);
            }
          } catch (err: any) {
            console.error('[Print] Failed to update status:', err);
            Alert.alert('Status Update Error', `${err.message || err}`);
          }
        } else {
          Alert.alert('✓ Printed', `Order #${order.order_number} printed successfully`);
        }
      } else {
        console.error(`[Print] ❌ Print FAILED for order #${order.order_number}`);
        // Update settings to reflect that printer may be disconnected
        updateSettings({ printerConnected: false });
        Alert.alert(
          'Print Failed', 
          'Could not print the order. The printer may have disconnected.\n\nPlease reconnect the printer in Settings and try again.'
        );
      }
    } catch (error: any) {
      console.error('[Print] ❌ Error:', error);
      updateSettings({ printerConnected: false });
      Alert.alert('Print Error', `An error occurred while printing:\n${error?.message || error}`);
    } finally {
      setPrintingOrderId(null);
    }
  }, [printerConnected, settings?.defaultPrintType, settings?.printerMacAddress, settings?.printerName, markAsPrinted, updateOrderStatus, updateSettings]);

  // Auto-print new orders
  const autoPrintOrder = useCallback(async (order: Order) => {
    if (!settings?.autoPrint || !printerConnected) return;
    
    console.log(`[AutoPrint] Printing order #${order.order_number}...`);
    await handlePrint(order);
  }, [settings?.autoPrint, printerConnected, handlePrint]);

  // AUTO-PRINT - Only prints NEW orders, NEVER reprints
  useEffect(() => {
    // WAIT until printed IDs are loaded from storage
    if (!printedIdsLoaded) {
      console.log('[AutoPrint] Waiting for printed IDs to load...');
      return;
    }
    
    // First load - mark all existing orders as known (don't print old orders)
    if (lastKnownOrderIds.current.size === 0 && ordersList.length > 0) {
      console.log(`[AutoPrint] Initial load - ${ordersList.length} existing orders marked as known`);
      lastKnownOrderIds.current = new Set(ordersList.map(o => o.id));
      return;
    }
    
    // Skip if auto-print disabled or no printer
    if (!settings?.autoPrint || !printerConnected) {
      lastKnownOrderIds.current = new Set(ordersList.map(o => o.id));
      return;
    }
    
    // Find NEW orders to print:
    // 1. NOT already printed (check printedOrderIds first!)
    // 2. Not in known list (just arrived)
    // 3. Status is pending
    // 4. Created in last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const newOrders = ordersList.filter(order => {
      // MOST IMPORTANT: Skip if already printed
      if (printedOrderIds.has(order.id)) {
        return false;
      }
      
      const isNewToSession = !lastKnownOrderIds.current.has(order.id);
      const isPending = order.status === 'pending';
      const isRecent = new Date(order.created_at) > fiveMinutesAgo;
      
      return isNewToSession && isPending && isRecent;
    });
    
    if (newOrders.length > 0) {
      console.log(`[AutoPrint] 🆕 ${newOrders.length} NEW orders to print!`);
      Vibration.vibrate([0, 500, 200, 500]);
      
      // Print each order with delay
      newOrders.forEach((order, index) => {
        setTimeout(() => {
          // Double-check not printed before actually printing
          if (!printedOrderIds.has(order.id)) {
            autoPrintOrder(order);
          }
        }, index * 2000);
      });
    }
    
    // Update known orders
    lastKnownOrderIds.current = new Set(ordersList.map(o => o.id));
  }, [ordersList, printedIdsLoaded, printedOrderIds, settings?.autoPrint, printerConnected, autoPrintOrder]);

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

  // Auto-select the most recent order on load
  useEffect(() => {
    if (ordersList.length > 0 && !selectedOrderId) {
      // Sort by created_at descending and select the newest
      const sortedOrders = [...ordersList].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      const newestOrder = sortedOrders[0];
      if (newestOrder) {
        console.log(`[AutoSelect] Opening most recent order #${newestOrder.order_number}`);
        setSelectedOrderId(newestOrder.id);
      }
    }
  }, [ordersList.length]); // Only run when order count changes

  // Auto-reconnect printer on app load and periodically verify connection
  useEffect(() => {
    const autoReconnect = async () => {
      // Only attempt if we have a stored printer address
      if (!settings?.printerMacAddress) {
        console.log('[AutoConnect] No printer configured');
        return;
      }

      // Check if we're actually connected
      const actuallyConnected = isPrinterConnected();
      const storedAsConnected = settings?.printerConnected;

      console.log(`[AutoConnect] State check - stored: ${storedAsConnected}, actual: ${actuallyConnected}`);

      if (!actuallyConnected) {
        console.log(`[AutoConnect] 🔄 Reconnecting to ${settings.printerName}...`);
        try {
          const success = await connectPrinter(settings.printerMacAddress);
          if (success) {
            updateSettings({ printerConnected: true });
            console.log('[AutoConnect] ✓ Reconnected successfully!');
          } else {
            // Connection failed - update UI to reflect reality
            if (storedAsConnected) {
              console.log('[AutoConnect] ❌ Reconnection failed, updating UI state');
              updateSettings({ printerConnected: false });
            }
          }
        } catch (error) {
          console.error('[AutoConnect] ❌ Failed:', error);
          if (storedAsConnected) {
            updateSettings({ printerConnected: false });
          }
        }
      } else if (!storedAsConnected) {
        // Actually connected but UI doesn't know - sync state
        console.log('[AutoConnect] ✓ Already connected, syncing UI state');
        updateSettings({ printerConnected: true });
      }
    };
    
    // Initial reconnect attempt
    const timer = setTimeout(autoReconnect, 2000);
    
    // Periodic connection check (every 30 seconds)
    const interval = setInterval(autoReconnect, 30000);
    
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [settings?.printerMacAddress, settings?.printerName, settings?.printerConnected, updateSettings]);

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

  // Mark as printed callback (used by detail panel)
  const handlePrinted = useCallback((orderId: string) => {
    markAsPrinted(orderId);
  }, [markAsPrinted]);

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
  };

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
          >
            <Text style={styles.settingsIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>

      {/* Main Content */}
      <View style={styles.content}>
        {/* Order List Column - Full width when no order selected */}
        <View style={[styles.listColumn, dynamicStyles.listColumn, !selectedOrder && styles.listColumnFull]}>
          <OrderFilters
            selectedFilter={activeFilter}
            onFilterChange={setActiveFilter}
            onRefresh={handleRefresh}
            counts={counts}
          />

          {/* Table Header */}
          <View style={[styles.tableHeader, { borderBottomColor: theme.cardBorder }]}>
            <Text style={[styles.tableHeaderText, styles.customerCol, { color: theme.textMuted }]}>Customer</Text>
            <Text style={[styles.tableHeaderText, styles.typeCol, { color: theme.textMuted }]}>Type</Text>
            <Text style={[styles.tableHeaderText, styles.printedCol, { color: theme.textMuted }]}>Printed</Text>
            <Text style={[styles.tableHeaderText, styles.timeCol, { color: theme.textMuted }]}>Time</Text>
      </View>

          {orders?.isLoading && ordersList.length === 0 ? (
        <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={[styles.loadingText, dynamicStyles.headerSubtext]}>
                Loading orders...
              </Text>
        </View>
          ) : filteredOrders.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={[styles.emptyText, dynamicStyles.headerSubtext]}>
                No orders found
              </Text>
        </View>
          ) : (
          <FlatList
              data={filteredOrders}
            keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <OrderListItem
                  order={item}
                  isSelected={selectedOrderId === item.id}
                  isPrinted={printedOrderIds.has(item.id)}
                  onPress={() => setSelectedOrderId(item.id)}
                />
              )}
            refreshControl={
              <RefreshControl
                  refreshing={refreshing}
                onRefresh={handleRefresh}
                  tintColor={theme.primary}
                />
              }
            contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>

      {/* Detail Panel - Full height overlay when order selected */}
      {selectedOrder && (
        <View style={[styles.detailOverlay, dynamicStyles.detailColumn]}>
          <OrderDetailPanel
            order={selectedOrder}
            onStatusChange={handleStatusChange}
            onPrinted={handlePrinted}
            onClose={() => setSelectedOrderId(null)}
            printerConnected={printerConnected}
          />
        </View>
      )}
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
});

export default OrdersListScreen;
