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
  isPrinterConnected 
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

// Storage keys
const PRINTED_ORDERS_KEY = '@printed_order_ids';

// Track printed orders
let printedOrderIds = new Set<string>();

const loadPrintedOrderIds = async () => {
  try {
    const stored = await AsyncStorage.getItem(PRINTED_ORDERS_KEY);
    if (stored) {
      printedOrderIds = new Set(JSON.parse(stored));
      console.log(`[PrintQueue] Loaded ${printedOrderIds.size} printed order IDs`);
    }
  } catch (error) {
    console.error('[PrintQueue] Error loading printed IDs:', error);
  }
};

const savePrintedOrderIds = async () => {
  try {
    await AsyncStorage.setItem(
      PRINTED_ORDERS_KEY,
      JSON.stringify([...printedOrderIds])
    );
  } catch (error) {
    console.error('[PrintQueue] Error saving printed IDs:', error);
  }
};

// Initialize
loadPrintedOrderIds();

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
  const [activeFilter, setActiveFilter] = useState<FilterStatus>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

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

  // Print function
  const handlePrint = useCallback(async (order: Order) => {
    if (!printerConnected) {
      Alert.alert('Printer Not Connected', 'Please connect a printer in Settings first.');
      return;
    }

    setPrintingOrderId(order.id);
    try {
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
        printedOrderIds.add(order.id);
        savePrintedOrderIds();
        Vibration.vibrate(100);
        forceUpdate(n => n + 1);
      } else {
        Alert.alert('Print Failed', 'Could not print the order. Please try again.');
      }
    } catch (error) {
      console.error('[Print] Error:', error);
      Alert.alert('Print Error', 'An error occurred while printing.');
    } finally {
      setPrintingOrderId(null);
    }
  }, [printerConnected, settings?.defaultPrintType]);

  // Auto-print new orders
  const autoPrintOrder = useCallback(async (order: Order) => {
    if (!settings?.autoPrint || !printerConnected) return;
    
    console.log(`[AutoPrint] Printing order #${order.order_number}...`);
    await handlePrint(order);
  }, [settings?.autoPrint, printerConnected, handlePrint]);

  // Check for new orders - ONLY auto-print truly new orders (created in last 5 mins)
  useEffect(() => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    // On first load, just record existing order IDs - don't print anything
    if (lastKnownOrderIds.current.size === 0 && ordersList.length > 0) {
      console.log(`[AutoPrint] Initial load - marking ${ordersList.length} orders as known (won't auto-print)`);
      lastKnownOrderIds.current = new Set(ordersList.map(o => o.id));
      return;
    }

    // Find truly NEW orders:
    // 1. Not in our known list (just arrived)
    // 2. Not already printed
    // 3. Status is pending
    // 4. Created within last 5 minutes (truly fresh)
    const newOrders = ordersList.filter(order => {
      const orderDate = new Date(order.created_at);
      const isNew = !lastKnownOrderIds.current.has(order.id);
      const notPrinted = !printedOrderIds.has(order.id);
      const isPending = order.status === 'pending';
      const isRecent = orderDate > fiveMinutesAgo;
      
      if (isNew && notPrinted && isPending) {
        console.log(`[AutoPrint] Order #${order.order_number}: recent=${isRecent}, created=${order.created_at}`);
      }
      
      return isNew && notPrinted && isPending && isRecent;
    });

    if (newOrders.length > 0) {
      console.log(`[AutoPrint] 🆕 ${newOrders.length} NEW orders to print!`);
      Vibration.vibrate([0, 500, 200, 500]);
      newOrders.forEach((order, index) => {
        setTimeout(() => autoPrintOrder(order), index * 2000);
      });
    }

    // Update known orders
    lastKnownOrderIds.current = new Set(ordersList.map(o => o.id));
  }, [ordersList, autoPrintOrder]);

  // Auto-reconnect printer
  useEffect(() => {
    const autoReconnect = async () => {
      if (settings?.printerMacAddress && !isPrinterConnected()) {
        console.log(`[AutoConnect] Reconnecting to ${settings.printerName}...`);
        try {
          const success = await connectPrinter(settings.printerMacAddress);
          if (success) {
            updateSettings({ printerConnected: true });
            console.log('[AutoConnect] Reconnected successfully!');
          }
        } catch (error) {
          console.error('[AutoConnect] Failed:', error);
        }
      }
    };
    
    const timer = setTimeout(autoReconnect, 2000);
    return () => clearTimeout(timer);
  }, [settings?.printerMacAddress, settings?.printerName, updateSettings]);

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

  // Mark as printed callback
  const handlePrinted = useCallback((orderId: string) => {
    printedOrderIds.add(orderId);
    savePrintedOrderIds();
    forceUpdate(n => n + 1);
  }, []);

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

        {/* Detail Panel - Overlay when order selected */}
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
    flex: 2,
  },
  typeCol: {
    flex: 1,
  },
  printedCol: {
    width: 70,
    textAlign: 'center',
  },
  timeCol: {
    width: 80,
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
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
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
