import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Order, OrderStatus } from '../types';

interface OrderCardProps {
  order: Order;
  onPress: (order: Order) => void;
  onAcknowledge?: (order: Order) => void;
}

const statusColors: Record<OrderStatus, string> = {
  pending: '#FF5722',
  confirmed: '#2196F3',
  preparing: '#FF9800',
  ready: '#4CAF50',
  completed: '#9E9E9E',
  cancelled: '#F44336',
};

const orderTypeLabels: Record<string, string> = {
  pickup: '🏃 Pickup',
  delivery: '🚗 Delivery',
  dine_in: '🍽️ Dine In',
};

const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const getTimeSince = (dateString: string) => {
  const now = new Date();
  const then = new Date(dateString);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const hours = Math.floor(diffMins / 60);
  return `${hours}h ${diffMins % 60}m ago`;
};

export const OrderCard: React.FC<OrderCardProps> = ({
  order,
  onPress,
  onAcknowledge,
}) => {
  const isPending = order.status === 'pending';
  const isNew = !order.acknowledged_at && order.status === 'pending';

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isPending && styles.cardPending,
        isNew && styles.cardNew,
      ]}
      onPress={() => onPress(order)}
      activeOpacity={0.7}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.orderInfo}>
          <Text style={styles.orderNumber}>#{order.order_number}</Text>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusColors[order.status] },
            ]}
          >
            <Text style={styles.statusText}>{order.status.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.time}>{formatTime(order.created_at)}</Text>
      </View>

      {/* Order Type */}
      <View style={styles.typeRow}>
        <Text style={styles.orderType}>
          {orderTypeLabels[order.order_type] || order.order_type}
        </Text>
        <Text style={styles.timeSince}>{getTimeSince(order.created_at)}</Text>
      </View>

      {/* Customer */}
      <View style={styles.customerRow}>
        <Text style={styles.customerName}>{order.customer.name}</Text>
        {order.customer.phone && (
          <Text style={styles.customerPhone}>{order.customer.phone}</Text>
        )}
      </View>

      {/* Items Summary */}
      <View style={styles.itemsContainer}>
        <Text style={styles.itemsLabel}>
          {order.items.length} item{order.items.length !== 1 ? 's' : ''}
        </Text>
        <View style={styles.itemsList}>
          {order.items.slice(0, 3).map((item, index) => (
            <Text key={item.id || index} style={styles.itemText} numberOfLines={1}>
              {item.quantity}× {item.name}
            </Text>
          ))}
          {order.items.length > 3 && (
            <Text style={styles.moreItems}>
              +{order.items.length - 3} more items
            </Text>
          )}
        </View>
      </View>

      {/* Total */}
      <View style={styles.footer}>
        <Text style={styles.total}>${order.total.toFixed(2)}</Text>

        {/* Acknowledge button for pending orders */}
        {isNew && onAcknowledge && (
          <TouchableOpacity
            style={styles.acknowledgeButton}
            onPress={(e) => {
              e.stopPropagation();
              onAcknowledge(order);
            }}
          >
            <Text style={styles.acknowledgeText}>Acknowledge</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* New order indicator */}
      {isNew && <View style={styles.newIndicator} />}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardPending: {
    borderColor: '#FF5722',
    borderWidth: 2,
  },
  cardNew: {
    backgroundColor: '#FFF3E0',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  orderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginRight: 10,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  time: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  typeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  orderType: {
    fontSize: 14,
    color: '#555',
    fontWeight: '500',
  },
  timeSince: {
    fontSize: 12,
    color: '#999',
  },
  customerRow: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  customerPhone: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  itemsContainer: {
    marginBottom: 12,
  },
  itemsLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  itemsList: {},
  itemText: {
    fontSize: 14,
    color: '#555',
    marginBottom: 2,
  },
  moreItems: {
    fontSize: 13,
    color: '#999',
    fontStyle: 'italic',
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  total: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  acknowledgeButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  acknowledgeText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  newIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF5722',
  },
});
