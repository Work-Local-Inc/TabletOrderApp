import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Order } from '../../types';
import { StatusBadge } from './StatusBadge';

interface OrderListItemProps {
  order: Order;
  isSelected: boolean;
  isPrinted: boolean;
  onPress: () => void;
}

const formatTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const getOrderTypeIcon = (type: string): string => {
  switch (type?.toLowerCase()) {
    case 'delivery': return '🚗';
    case 'dine_in': return '🍽️';
    case 'pickup':
    default: return '🛍️';
  }
};

export const OrderListItem: React.FC<OrderListItemProps> = ({
  order,
  isSelected,
  isPrinted,
  onPress,
}) => {
  const customerName = order.customer?.name || 'Walk-in Customer';
  const itemCount = order.items?.length || 0;
  const orderType = order.order_type || order.order_type || 'pickup';
  const typeIcon = getOrderTypeIcon(orderType);
  
  return (
    <TouchableOpacity
      style={[
        styles.container,
        isSelected && styles.containerSelected,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Left: Status indicator */}
      <View style={styles.statusColumn}>
        {!isPrinted && order.status === 'pending' && (
          <View style={styles.newDot} />
        )}
        {isPrinted && (
          <Text style={styles.printedCheck}>✓</Text>
        )}
      </View>
      
      {/* Middle: Order info */}
      <View style={styles.infoColumn}>
        <View style={styles.topRow}>
          <Text style={styles.customerName} numberOfLines={1}>
            {customerName}
          </Text>
          <Text style={styles.time}>{formatTime(order.created_at)}</Text>
        </View>
        
        <View style={styles.bottomRow}>
          <Text style={styles.orderMeta}>
            {typeIcon} {orderType.replace('_', ' ')} • {itemCount} item{itemCount !== 1 ? 's' : ''}
          </Text>
          <Text style={styles.total}>${order.total?.toFixed(2) || '0.00'}</Text>
        </View>
        
        {/* Order notes preview */}
        {order.notes && (
          <Text style={styles.notes} numberOfLines={1}>
            📝 {order.notes}
          </Text>
        )}
      </View>
      
      {/* Right: Arrow indicator */}
      <View style={styles.arrowColumn}>
        <Text style={[styles.arrow, isSelected && styles.arrowSelected]}>›</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    marginBottom: 8,
    padding: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  containerSelected: {
    borderColor: '#3b82f6',
    backgroundColor: '#1e3a5f',
  },
  statusColumn: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#3b82f6',
  },
  printedCheck: {
    fontSize: 16,
    color: '#22c55e',
  },
  infoColumn: {
    flex: 1,
    marginLeft: 10,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    flex: 1,
    marginRight: 8,
  },
  time: {
    fontSize: 13,
    color: '#94a3b8',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderMeta: {
    fontSize: 13,
    color: '#64748b',
    textTransform: 'capitalize',
  },
  total: {
    fontSize: 14,
    fontWeight: '600',
    color: '#22c55e',
  },
  notes: {
    fontSize: 12,
    color: '#fbbf24',
    marginTop: 6,
    fontStyle: 'italic',
  },
  arrowColumn: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    fontSize: 24,
    color: '#475569',
    fontWeight: '300',
  },
  arrowSelected: {
    color: '#3b82f6',
  },
});

export default OrderListItem;

