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
} from 'react-native';
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
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastKnownOrderIds = useRef<Set<string>>(new Set());
  
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

  // Check for new orders
  useEffect(() => {
    if (lastKnownOrderIds.current.size === 0 && ordersList.length > 0) {
      lastKnownOrderIds.current = new Set(ordersList.map(o => o.id));
      return;
    }

    const newOrders = ordersList.filter(order =>
      !lastKnownOrderIds.current.has(order.id) &&
      !printedOrderIds.has(order.id) &&
      order.status === 'pending'
    );

    if (newOrders.length > 0) {
      console.log(`[NewOrders] Found ${newOrders.length} new orders!`);
      Vibration.vibrate([0, 500, 200, 500]);
      newOrders.forEach((order, index) => {
        setTimeout(() => autoPrintOrder(order), index * 2000);
      });
    }

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
    header: { backgroundColor: theme.headerBg, borderBottomColor: theme.headerBorder },
    headerText: { color: theme.text },
    headerSubtext: { color: theme.textSecondary },
    listColumn: { backgroundColor: theme.surface, borderRightColor: theme.cardBorder },
    detailColumn: { backgroundColor: theme.background },
    printerBadge: { backgroundColor: printerConnected ? theme.success : theme.danger },
  };

  return (
    <View style={[styles.container, dynamicStyles.container]}>
      {/* Header */}
      <View style={[styles.header, dynamicStyles.header]}>
        <View style={styles.headerLeft}>
          <Image 
            source={require('../../assets/logo.png')} 
            style={styles.logo}
            resizeMode="contain"
          />
          <View style={styles.headerInfo}>
            <Text style={[styles.headerTitle, dynamicStyles.headerText]}>
              {auth?.restaurantName || 'Kitchen Printer'}
            </Text>
            <View style={styles.statusRow}>
              <View style={[styles.printerBadge, dynamicStyles.printerBadge]}>
                <Text style={styles.printerBadgeText}>
                  {printerConnected ? '🖨️ Connected' : '⚠️ No Printer'}
                </Text>
              </View>
            </View>
          </View>
        </View>
        
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.settingsIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content - Split View */}
      <View style={styles.content}>
        {/* Order List Column */}
        <View style={[styles.listColumn, dynamicStyles.listColumn]}>
          <View style={styles.listHeader}>
            <Text style={[styles.listTitle, dynamicStyles.headerText]}>Orders</Text>
            <TouchableOpacity onPress={handleRefresh}>
              <Text style={styles.refreshIcon}>🔄</Text>
            </TouchableOpacity>
          </View>
          
          <OrderFilters
            selectedFilter={activeFilter}
            onFilterChange={setActiveFilter}
            counts={counts}
          />

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

        {/* Detail Column */}
        <View style={[styles.detailColumn, dynamicStyles.detailColumn]}>
          <OrderDetailPanel
            order={selectedOrder}
            onStatusChange={handleStatusChange}
            onPrinted={handlePrinted}
            printerConnected={printerConnected}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  logo: {
    width: 50,
    height: 50,
    marginRight: 15,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  printerBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  printerBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingsButton: {
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
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
    flex: 2,
    borderRightWidth: 1,
    paddingTop: 16,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  refreshIcon: {
    fontSize: 20,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 20,
  },
  detailColumn: {
    flex: 3,
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
