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
import { Order } from '../types';
import { 
  printOrder, 
  printKitchenTicket, 
  printCustomerReceipt, 
  printBoth,
  connectPrinter, 
  isPrinterConnected 
} from '../services/printService';

// Print type options
type PrintType = 'kitchen' | 'receipt' | 'both';
const PRINT_TYPES: { key: PrintType; label: string; icon: string }[] = [
  { key: 'kitchen', label: 'Kitchen', icon: '🍳' },
  { key: 'receipt', label: 'Receipt', icon: '🧾' },
  { key: 'both', label: 'Both', icon: '📋' },
];

type RootStackParamList = {
  Orders: undefined;
  OrderDetail: { orderId: string };
  Settings: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Orders'>;

// Storage keys
const PRINTED_ORDERS_KEY = '@printed_order_ids';
const FAILED_ORDERS_KEY = '@failed_print_order_ids';

// Track which orders have been printed (will be loaded from storage)
let printedOrderIds = new Set<string>();
let failedPrintOrderIds = new Set<string>();

// Load printed order IDs from storage
const loadPrintedOrderIds = async () => {
  try {
    const [printedJson, failedJson] = await Promise.all([
      AsyncStorage.getItem(PRINTED_ORDERS_KEY),
      AsyncStorage.getItem(FAILED_ORDERS_KEY),
    ]);
    
    if (printedJson) {
      const ids = JSON.parse(printedJson);
      printedOrderIds = new Set(ids);
      console.log(`[PrintQueue] Loaded ${printedOrderIds.size} printed order IDs`);
    }
    if (failedJson) {
      const ids = JSON.parse(failedJson);
      failedPrintOrderIds = new Set(ids);
    }
  } catch (error) {
    console.error('[PrintQueue] Error loading printed IDs:', error);
  }
};

// Save printed order IDs to storage
const savePrintedOrderIds = async () => {
  try {
    await Promise.all([
      AsyncStorage.setItem(PRINTED_ORDERS_KEY, JSON.stringify([...printedOrderIds])),
      AsyncStorage.setItem(FAILED_ORDERS_KEY, JSON.stringify([...failedPrintOrderIds])),
    ]);
  } catch (error) {
    console.error('[PrintQueue] Error saving printed IDs:', error);
  }
};

// Initialize - load from storage
loadPrintedOrderIds();

export const OrdersListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);
  const [, forceUpdate] = useState(0); // For re-rendering after print status changes
  const lastKnownOrderIds = useRef<Set<string>>(new Set());
  
  // Get store values FIRST
  const {
    orders,
    fetchOrders,
    selectOrder,
    settings,
    updateSettings,
    offline,
    auth,
  } = useStore();
  
  const printerConnected = settings?.printerConnected ?? false;
  
  // Use print type from settings, with local override for quick switching
  const [localPrintType, setLocalPrintType] = useState<PrintType | null>(null);
  const selectedPrintType = localPrintType || settings?.defaultPrintType || 'kitchen';
  
  const setSelectedPrintType = (type: PrintType) => {
    setLocalPrintType(type);
    // Also save to settings as the new default
    updateSettings({ defaultPrintType: type });
  };

  // Print order using selected print type
  const doPrint = useCallback(async (order: Order, printType: PrintType): Promise<boolean> => {
    switch (printType) {
      case 'kitchen':
        return await printKitchenTicket(order);
      case 'receipt':
        return await printCustomerReceipt(order);
      case 'both':
        return await printBoth(order);
      default:
        return await printKitchenTicket(order);
    }
  }, []);

  // Auto-print new orders
  const autoPrintOrder = useCallback(async (order: Order) => {
    if (!settings.autoPrint) return;
    if (!printerConnected) {
      console.log('[AutoPrint] Printer not connected, adding to queue');
      failedPrintOrderIds.add(order.id);
      forceUpdate(n => n + 1);
      return;
    }

    try {
      setPrintingOrderId(order.id);
      console.log(`[AutoPrint] Printing ${selectedPrintType} for order #${order.orderNumber}...`);
      
      const success = await doPrint(order, selectedPrintType);
      
      if (success) {
        console.log(`[AutoPrint] Order #${order.orderNumber} printed successfully!`);
        printedOrderIds.add(order.id);
        failedPrintOrderIds.delete(order.id);
        savePrintedOrderIds(); // Persist to storage
        Vibration.vibrate(100); // Quick success vibration
      } else {
        console.log(`[AutoPrint] Order #${order.orderNumber} print failed`);
        failedPrintOrderIds.add(order.id);
        savePrintedOrderIds();
      }
    } catch (error) {
      console.error(`[AutoPrint] Error printing order:`, error);
      failedPrintOrderIds.add(order.id);
      savePrintedOrderIds();
    } finally {
      setPrintingOrderId(null);
      forceUpdate(n => n + 1);
    }
  }, [settings.autoPrint, printerConnected, selectedPrintType, doPrint]);

  // Check for new orders and auto-print them
  useEffect(() => {
    // Skip on initial load when we haven't seen any orders yet
    if (lastKnownOrderIds.current.size === 0 && orders.orders.length > 0) {
      // First load - just record what we have, don't auto-print old orders
      lastKnownOrderIds.current = new Set(orders.orders.map(o => o.id));
      console.log(`[NewOrders] Initial load: ${orders.orders.length} existing orders`);
      return;
    }
    
    // Find truly NEW orders (appeared since last check)
    const newOrders = orders.orders.filter(order => 
      !lastKnownOrderIds.current.has(order.id) &&
      !printedOrderIds.has(order.id) &&
      !failedPrintOrderIds.has(order.id) &&
      order.status === 'pending'
    );

    if (newOrders.length > 0) {
      console.log(`[NewOrders] 🆕 Found ${newOrders.length} NEW orders to print!`);
      
      // Play alert and auto-print each new order
      Vibration.vibrate([0, 500, 200, 500]); // Alert pattern
      
      newOrders.forEach((order, index) => {
        // Stagger prints slightly to avoid overwhelming the printer
        setTimeout(() => autoPrintOrder(order), index * 2000);
      });
    }

    // Update known order IDs
    lastKnownOrderIds.current = new Set(orders.orders.map(o => o.id));
  }, [orders.orders, autoPrintOrder]);

  // Auto-reconnect to saved printer on startup
  useEffect(() => {
    const autoReconnect = async () => {
      // Check if we have a saved printer and not already connected
      if (settings.printerMacAddress && !isPrinterConnected()) {
        console.log(`[AutoConnect] Attempting to reconnect to ${settings.printerName}...`);
        try {
          const success = await connectPrinter(settings.printerMacAddress);
          if (success) {
            console.log('[AutoConnect] ✓ Reconnected successfully!');
            updateSettings({ printerConnected: true });
          } else {
            console.log('[AutoConnect] Reconnect failed - printer may be off');
            updateSettings({ printerConnected: false });
          }
        } catch (error) {
          console.log('[AutoConnect] Reconnect error:', error);
          updateSettings({ printerConnected: false });
        }
        forceUpdate(n => n + 1);
      }
    };
    
    // Small delay to let Bluetooth initialize
    const timer = setTimeout(autoReconnect, 2000);
    return () => clearTimeout(timer);
  }, []); // Only run once on mount

  // Load printed IDs and start polling when screen is focused
  useFocusEffect(
    useCallback(() => {
      // Reload printed IDs from storage (in case they weren't loaded yet)
      loadPrintedOrderIds().then(() => forceUpdate(n => n + 1));
      
      fetchOrders();

      pollIntervalRef.current = setInterval(() => {
        if (offline.isOnline) {
          fetchOrders();
        }
      }, settings.pollIntervalMs);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }, [settings.pollIntervalMs, offline.isOnline])
  );

  const handleOrderPress = useCallback(
    (order: Order) => {
      selectOrder(order);
      navigation.navigate('OrderDetail', { orderId: order.id });
    },
    [navigation, selectOrder]
  );

  const handleManualPrint = useCallback(async (order: Order, overridePrintType?: PrintType) => {
    if (!printerConnected) {
      Alert.alert('Printer Not Connected', 'Please connect a printer in Settings first.');
      return;
    }

    const printType = overridePrintType || selectedPrintType;
    const printLabel = PRINT_TYPES.find(t => t.key === printType)?.label || 'Order';

    try {
      setPrintingOrderId(order.id);
      const success = await doPrint(order, printType);
      
      if (success) {
        printedOrderIds.add(order.id);
        failedPrintOrderIds.delete(order.id);
        savePrintedOrderIds(); // Persist to storage
        Alert.alert('✓ Printed', `${printLabel} ticket for Order #${order.orderNumber} sent to printer`);
        Vibration.vibrate(100);
      } else {
        Alert.alert('Print Failed', 'Could not print order. Please try again.');
      }
    } catch (error: any) {
      Alert.alert('Print Error', error.message || 'Unknown error');
    } finally {
      setPrintingOrderId(null);
      forceUpdate(n => n + 1);
    }
  }, [printerConnected, selectedPrintType, doPrint]);

  const handleRefresh = useCallback(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Categorize orders for the print-focused view
  const printQueueOrders = orders.orders.filter(o => 
    !printedOrderIds.has(o.id) && (o.status === 'pending' || failedPrintOrderIds.has(o.id))
  );
  
  const printedOrders = orders.orders.filter(o => 
    printedOrderIds.has(o.id)
  );

  const renderPrintQueueItem = ({ item }: { item: Order }) => {
    const isPrinting = printingOrderId === item.id;
    const hasFailed = failedPrintOrderIds.has(item.id);

    return (
      <View style={styles.orderCard}>
        <TouchableOpacity 
          style={styles.orderContent}
          onPress={() => handleOrderPress(item)}
        >
          <View style={styles.orderHeader}>
            <Text style={styles.orderNumber}>#{item.orderNumber}</Text>
            <Text style={styles.orderType}>{item.orderType}</Text>
          </View>
          
          <Text style={styles.customerName}>
            {item.customer?.name || 'Walk-in Customer'}
          </Text>
          
          <Text style={styles.itemCount}>
            {item.items.length} item{item.items.length !== 1 ? 's' : ''} • ${item.total.toFixed(2)}
          </Text>
          
          {item.notes && (
            <View style={styles.notesContainer}>
              <Text style={styles.notesLabel}>📝 Notes:</Text>
              <Text style={styles.notesText}>{item.notes}</Text>
            </View>
          )}

          {hasFailed && (
            <View style={styles.failedBadge}>
              <Text style={styles.failedText}>⚠️ Print failed - tap to retry</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.printButton,
            isPrinting && styles.printButtonDisabled,
            hasFailed && styles.printButtonRetry,
          ]}
          onPress={() => handleManualPrint(item)}
          disabled={isPrinting}
        >
          {isPrinting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Text style={styles.printIcon}>🖨️</Text>
              <Text style={styles.printButtonText}>
                {hasFailed ? 'RETRY' : 'PRINT'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderPrintedItem = ({ item }: { item: Order }) => (
    <TouchableOpacity 
      style={styles.printedCard}
      onPress={() => handleOrderPress(item)}
    >
      <View style={styles.printedHeader}>
        <Text style={styles.printedOrderNumber}>#{item.orderNumber}</Text>
        <Text style={styles.printedCheck}>✓</Text>
      </View>
      <Text style={styles.printedCustomer}>
        {item.customer?.name || 'Walk-in'} • {item.items.length} items
      </Text>
      <TouchableOpacity
        style={styles.reprintButton}
        onPress={() => handleManualPrint(item)}
      >
        <Text style={styles.reprintText}>Reprint</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Image 
          source={require('../../assets/logo.png')} 
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <View style={styles.headerLeft}>
          <Text style={styles.restaurantName}>{auth.restaurantName || 'Kitchen Printer'}</Text>
          <Text style={styles.deviceName}>
            {printerConnected ? '🟢 Printer Connected' : '🔴 No Printer'}
            {settings.autoPrint ? ' • Auto-Print ON' : ''}
          </Text>
        </View>
        
        {/* Print Type Selector */}
        <View style={styles.printTypeSelector}>
          <Text style={styles.printTypeLabel}>Print:</Text>
          {PRINT_TYPES.map((type) => (
            <TouchableOpacity
              key={type.key}
              style={[
                styles.printTypeButton,
                selectedPrintType === type.key && styles.printTypeButtonActive,
              ]}
              onPress={() => setSelectedPrintType(type.key)}
            >
              <Text style={styles.printTypeIcon}>{type.icon}</Text>
              <Text style={[
                styles.printTypeText,
                selectedPrintType === type.key && styles.printTypeTextActive,
              ]}>
                {type.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        
        <View style={styles.headerRight}>
          {!offline.isOnline && (
            <View style={styles.offlineBadge}>
              <Text style={styles.offlineText}>Offline</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.settingsIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Loading indicator */}
      {orders.isLoading && orders.orders.length === 0 && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Loading orders...</Text>
        </View>
      )}

      {/* Error message */}
      {orders.error && !orders.isLoading && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{orders.error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Simplified 2-Column Layout */}
      <View style={styles.gridContainer}>
        {/* Print Queue - Orders to be printed */}
        <View style={[styles.column, styles.printQueueColumn]}>
          <View style={[styles.sectionHeader, { backgroundColor: '#FF5722' }]}>
            <Text style={styles.sectionTitle}>🖨️ Print Queue</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{printQueueOrders.length}</Text>
            </View>
          </View>
          <FlatList
            data={printQueueOrders}
            renderItem={renderPrintQueueItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={orders.isLoading}
                onRefresh={handleRefresh}
                colors={['#4CAF50']}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptySection}>
                <Text style={styles.emptyIcon}>✓</Text>
                <Text style={styles.emptyText}>All orders printed!</Text>
                <Text style={styles.emptySubtext}>New orders will appear here</Text>
              </View>
            }
          />
        </View>

        {/* Printed Today - Reference/Archive */}
        <View style={[styles.column, styles.printedColumn]}>
          <View style={[styles.sectionHeader, { backgroundColor: '#4CAF50' }]}>
            <Text style={styles.sectionTitle}>✓ Printed</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{printedOrders.length}</Text>
            </View>
          </View>
          <FlatList
            data={printedOrders}
            renderItem={renderPrintedItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptySection}>
                <Text style={styles.emptyText}>No printed orders yet</Text>
              </View>
            }
          />
        </View>
      </View>

      {/* Printer Status Bar */}
      {!printerConnected && (
        <TouchableOpacity 
          style={styles.printerWarning}
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={styles.printerWarningText}>
            ⚠️ No printer connected - Tap to connect in Settings
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLogo: {
    width: 120,
    height: 40,
    marginRight: 16,
    backgroundColor: '#16213e',
    padding: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#0f3460',
  },
  headerLeft: {
    flex: 1,
  },
  restaurantName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  deviceName: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  // Print Type Selector
  printTypeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f3460',
    borderRadius: 12,
    padding: 6,
    marginHorizontal: 16,
  },
  printTypeLabel: {
    color: '#94a3b8',
    fontSize: 14,
    marginRight: 8,
    marginLeft: 8,
  },
  printTypeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    marginHorizontal: 2,
  },
  printTypeButtonActive: {
    backgroundColor: '#22c55e',
  },
  printTypeIcon: {
    fontSize: 18,
    marginRight: 6,
  },
  printTypeText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  printTypeTextActive: {
    color: '#fff',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  offlineBadge: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 12,
  },
  offlineText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  settingsButton: {
    padding: 8,
    backgroundColor: '#0f3460',
    borderRadius: 8,
  },
  settingsIcon: {
    fontSize: 28,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#94a3b8',
  },
  errorContainer: {
    margin: 20,
    padding: 20,
    backgroundColor: '#3b1f1f',
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 16,
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },
  gridContainer: {
    flex: 1,
    flexDirection: 'row',
    padding: 12,
  },
  column: {
    flex: 1,
    marginHorizontal: 6,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#16213e',
  },
  printQueueColumn: {
    flex: 3, // Wider - like Square's main list area
  },
  printedColumn: {
    flex: 2, // Narrower sidebar for printed/completed
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
  },
  badgeText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 18,
  },
  listContent: {
    padding: 12,
  },
  emptySection: {
    padding: 60,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 64,
    color: '#4CAF50',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    color: '#64748b',
    fontWeight: '500',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#475569',
    marginTop: 8,
  },
  // Order Card Styles
  orderCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  orderContent: {
    padding: 16,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  orderType: {
    fontSize: 14,
    color: '#94a3b8',
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    textTransform: 'uppercase',
  },
  customerName: {
    fontSize: 16,
    color: '#e2e8f0',
    marginBottom: 4,
  },
  itemCount: {
    fontSize: 14,
    color: '#64748b',
  },
  notesContainer: {
    marginTop: 12,
    padding: 10,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
  },
  notesLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400e',
    marginBottom: 4,
  },
  notesText: {
    fontSize: 14,
    color: '#78350f',
  },
  failedBadge: {
    marginTop: 12,
    padding: 8,
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
  },
  failedText: {
    color: '#fca5a5',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  printButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22c55e',
    padding: 16,
  },
  printButtonDisabled: {
    backgroundColor: '#64748b',
  },
  printButtonRetry: {
    backgroundColor: '#f59e0b',
  },
  printIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  printButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  // Printed Card Styles
  printedCard: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#22c55e',
  },
  printedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  printedOrderNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#94a3b8',
  },
  printedCheck: {
    fontSize: 18,
    color: '#22c55e',
  },
  printedCustomer: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },
  reprintButton: {
    marginTop: 8,
    padding: 6,
    backgroundColor: '#334155',
    borderRadius: 6,
    alignItems: 'center',
  },
  reprintText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '500',
  },
  // Bottom warning
  printerWarning: {
    backgroundColor: '#f59e0b',
    padding: 14,
    alignItems: 'center',
  },
  printerWarningText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 16,
  },
});
