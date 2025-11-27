import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useStore } from '../store/useStore';
import { OrderStatus } from '../types';
import { printOrder } from '../services/printService';

type RootStackParamList = {
  Orders: undefined;
  OrderDetail: { orderId: string };
  Settings: undefined;
};

type RouteProps = RouteProp<RootStackParamList, 'OrderDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'OrderDetail'>;

const statusFlow: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'completed'];

const statusColors: Record<OrderStatus, string> = {
  pending: '#FF5722',
  confirmed: '#2196F3',
  preparing: '#FF9800',
  ready: '#4CAF50',
  completed: '#9E9E9E',
  cancelled: '#F44336',
};

const statusLabels: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const orderTypeLabels: Record<string, { label: string; icon: string }> = {
  pickup: { label: 'Pickup', icon: '🏃' },
  delivery: { label: 'Delivery', icon: '🚗' },
  dine_in: { label: 'Dine In', icon: '🍽️' },
};

export const OrderDetailScreen: React.FC = () => {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<NavigationProp>();
  const { orderId } = route.params;

  const [isUpdating, setIsUpdating] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  const { orders, fetchOrder, updateOrderStatus, settings } = useStore();
  const order = orders.selectedOrder || orders.orders.find((o) => o.id === orderId);

  useEffect(() => {
    if (!order) {
      fetchOrder(orderId);
    }
  }, [orderId, order, fetchOrder]);

  const getNextStatus = useCallback((): OrderStatus | null => {
    if (!order) return null;
    const currentIndex = statusFlow.indexOf(order.status);
    if (currentIndex === -1 || currentIndex >= statusFlow.length - 1) return null;
    return statusFlow[currentIndex + 1];
  }, [order]);

  const handleStatusUpdate = useCallback(
    async (newStatus: OrderStatus) => {
      if (!order) return;

      setIsUpdating(true);
      const success = await updateOrderStatus(order.id, newStatus);
      setIsUpdating(false);

      if (!success) {
        Alert.alert('Error', 'Failed to update order status. Please try again.');
      }
    },
    [order, updateOrderStatus]
  );

  const handleCancel = useCallback(() => {
    Alert.alert(
      'Cancel Order',
      'Are you sure you want to cancel this order? This action cannot be undone.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel Order',
          style: 'destructive',
          onPress: () => handleStatusUpdate('cancelled'),
        },
      ]
    );
  }, [handleStatusUpdate]);

  const handlePrint = useCallback(async () => {
    if (!order) return;

    setIsPrinting(true);
    try {
      await printOrder(order);
      Alert.alert('Success', 'Order sent to printer');
    } catch (error) {
      Alert.alert('Print Error', 'Failed to print order. Check printer connection.');
    }
    setIsPrinting(false);
  }, [order]);

  if (!order) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading order...</Text>
      </View>
    );
  }

  const nextStatus = getNextStatus();
  const orderTypeInfo = orderTypeLabels[order.order_type] || {
    label: order.order_type,
    icon: '📦',
  };
  const isCompleted = order.status === 'completed' || order.status === 'cancelled';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.orderNumber}>Order #{order.order_number}</Text>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusColors[order.status] },
            ]}
          >
            <Text style={styles.statusText}>{statusLabels[order.status]}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.printButton, isPrinting && styles.buttonDisabled]}
          onPress={handlePrint}
          disabled={isPrinting}
        >
          {isPrinting ? (
            <ActivityIndicator size="small" color="#666" />
          ) : (
            <Text style={styles.printIcon}>🖨️</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Order Type & Customer */}
        <View style={styles.section}>
          <View style={styles.orderTypeRow}>
            <View style={styles.orderTypeBadge}>
              <Text style={styles.orderTypeIcon}>{orderTypeInfo.icon}</Text>
              <Text style={styles.orderTypeLabel}>{orderTypeInfo.label}</Text>
            </View>
            <Text style={styles.orderTime}>
              {new Date(order.created_at).toLocaleString()}
            </Text>
          </View>
        </View>

        {/* Customer Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer</Text>
          <View style={styles.customerCard}>
            <Text style={styles.customerName}>{order.customer.name}</Text>
            <Text style={styles.customerContact}>{order.customer.phone}</Text>
            {order.customer.email && (
              <Text style={styles.customerContact}>{order.customer.email}</Text>
            )}
          </View>
        </View>

        {/* Delivery Address */}
        {order.delivery_address && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Delivery Address</Text>
            <View style={styles.addressCard}>
              <Text style={styles.addressText}>
                {order.delivery_address.street}
                {order.delivery_address.unit && `, Unit ${order.delivery_address.unit}`}
              </Text>
              <Text style={styles.addressText}>
                {order.delivery_address.city}, {order.delivery_address.postalCode}
              </Text>
              {order.delivery_address.instructions && (
                <Text style={styles.deliveryInstructions}>
                  📝 {order.delivery_address.instructions}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Order Items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Items</Text>
          <View style={styles.itemsCard}>
            {order.items.map((item, index) => (
              <View
                key={item.id || index}
                style={[
                  styles.itemRow,
                  index < order.items.length - 1 && styles.itemRowBorder,
                ]}
              >
                <View style={styles.itemInfo}>
                  <View style={styles.itemHeader}>
                    <Text style={styles.itemQuantity}>{item.quantity}×</Text>
                    <Text style={styles.itemName}>{item.name}</Text>
                  </View>
                  {item.modifiers && item.modifiers.length > 0 && (
                    <View style={styles.modifiers}>
                      {item.modifiers.map((mod, modIndex) => (
                        <Text key={modIndex} style={styles.modifier}>
                          • {mod.name}
                          {mod.price > 0 && ` (+$${mod.price.toFixed(2)})`}
                        </Text>
                      ))}
                    </View>
                  )}
                  {item.notes && (
                    <Text style={styles.itemNotes}>📝 {item.notes}</Text>
                  )}
                </View>
                <Text style={styles.itemPrice}>
                  ${(item.price * item.quantity).toFixed(2)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Order Notes */}
        {order.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Order Notes</Text>
            <View style={styles.notesCard}>
              <Text style={styles.notesText}>{order.notes}</Text>
            </View>
          </View>
        )}

        {/* Totals */}
        <View style={styles.section}>
          <View style={styles.totalsCard}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>${order.subtotal.toFixed(2)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax</Text>
              <Text style={styles.totalValue}>${order.tax.toFixed(2)}</Text>
            </View>
            {order.tip !== undefined && order.tip > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Tip</Text>
                <Text style={styles.totalValue}>${order.tip.toFixed(2)}</Text>
              </View>
            )}
            {order.delivery_fee !== undefined && order.delivery_fee > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Delivery Fee</Text>
                <Text style={styles.totalValue}>${order.delivery_fee.toFixed(2)}</Text>
              </View>
            )}
            <View style={[styles.totalRow, styles.grandTotalRow]}>
              <Text style={styles.grandTotalLabel}>Total</Text>
              <Text style={styles.grandTotalValue}>${order.total.toFixed(2)}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      {!isCompleted && (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={[styles.cancelButton, isUpdating && styles.buttonDisabled]}
            onPress={handleCancel}
            disabled={isUpdating}
          >
            <Text style={styles.cancelButtonText}>Cancel Order</Text>
          </TouchableOpacity>

          {nextStatus && (
            <TouchableOpacity
              style={[
                styles.statusButton,
                { backgroundColor: statusColors[nextStatus] },
                isUpdating && styles.buttonDisabled,
              ]}
              onPress={() => handleStatusUpdate(nextStatus)}
              disabled={isUpdating}
            >
              {isUpdating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.statusButtonText}>
                    {nextStatus === 'confirmed' && 'Confirm Order'}
                    {nextStatus === 'preparing' && 'Start Preparing'}
                    {nextStatus === 'ready' && 'Mark Ready'}
                    {nextStatus === 'completed' && 'Complete Order'}
                  </Text>
                  <Text style={styles.statusButtonIcon}>→</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  backButton: {
    padding: 8,
  },
  backText: {
    fontSize: 16,
    color: '#4CAF50',
    fontWeight: '600',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginRight: 12,
  },
  statusBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  printButton: {
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  printIcon: {
    fontSize: 24,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 100,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  orderTypeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
  },
  orderTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  orderTypeIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  orderTypeLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976D2',
  },
  orderTime: {
    fontSize: 14,
    color: '#666',
  },
  customerCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
  },
  customerName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  customerContact: {
    fontSize: 15,
    color: '#666',
    marginTop: 2,
  },
  addressCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
  },
  addressText: {
    fontSize: 15,
    color: '#333',
    marginBottom: 2,
  },
  deliveryInstructions: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 8,
    padding: 10,
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
  },
  itemsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
  },
  itemRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  itemInfo: {
    flex: 1,
    marginRight: 16,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  itemQuantity: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4CAF50',
    marginRight: 8,
    minWidth: 30,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  modifiers: {
    marginTop: 6,
    marginLeft: 38,
  },
  modifier: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  itemNotes: {
    fontSize: 13,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 6,
    marginLeft: 38,
    padding: 8,
    backgroundColor: '#FFF8E1',
    borderRadius: 6,
  },
  notesCard: {
    backgroundColor: '#FFF8E1',
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#FFC107',
  },
  notesText: {
    fontSize: 15,
    color: '#333',
    lineHeight: 22,
  },
  totalsCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  totalLabel: {
    fontSize: 15,
    color: '#666',
  },
  totalValue: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  grandTotalRow: {
    borderTopWidth: 2,
    borderTopColor: '#e0e0e0',
    paddingTop: 12,
    marginTop: 4,
    marginBottom: 0,
  },
  grandTotalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  grandTotalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  actionBar: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#F44336',
    alignItems: 'center',
    marginRight: 12,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F44336',
  },
  statusButton: {
    flex: 2,
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginRight: 8,
  },
  statusButtonIcon: {
    fontSize: 18,
    color: '#fff',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
