import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Order } from '../../types';
import { useTheme } from '../../theme';

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

const getOrderTypeLabel = (type: string): string => {
  switch (type?.toLowerCase()) {
    case 'delivery': return 'Delivery';
    case 'dine_in': return 'Dine-in';
    case 'pickup':
    case 'takeout':
    default: return 'Pickup';
  }
};

export const OrderListItem: React.FC<OrderListItemProps> = ({
  order,
  isSelected,
  isPrinted,
  onPress,
}) => {
  const { theme, themeMode } = useTheme();
  const customerName = order.customer?.name || 'Walk-in';
  const orderType = order.order_type || 'pickup';
  
  const colors = {
    bg: themeMode === 'dark' ? '#1e293b' : '#ffffff',
    bgSelected: themeMode === 'dark' ? '#1e3a5f' : '#eff6ff',
    text: theme.text,
    textSecondary: theme.textSecondary,
    textMuted: theme.textMuted,
    border: themeMode === 'dark' ? '#334155' : '#e2e8f0',
  };
  
  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: isSelected ? colors.bgSelected : colors.bg, borderBottomColor: colors.border },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Customer Column */}
      <View style={styles.customerColumn}>
        <Text style={[styles.customerName, { color: colors.text }]} numberOfLines={1}>
          {customerName}
        </Text>
      </View>
      
      {/* Type Column */}
      <View style={styles.typeColumn}>
        <Text style={[styles.typeText, { color: colors.textSecondary }]}>
          {getOrderTypeLabel(orderType)}
        </Text>
      </View>
      
      {/* Printed Column - Green checkmark or Red circle */}
      <View style={styles.printedColumn}>
        {isPrinted ? (
          <View style={styles.printedYes}>
            <Text style={styles.printedYesText}>✓</Text>
          </View>
        ) : (
          <View style={styles.printedNo}>
            <Text style={styles.printedNoText}>○</Text>
          </View>
        )}
      </View>
      
      {/* Time Column */}
      <View style={styles.timeColumn}>
        <Text style={[styles.timeText, { color: colors.textMuted }]}>
          {formatTime(order.created_at)}
        </Text>
      </View>
      
      {/* New order indicator dot */}
      {!isPrinted && order.status === 'pending' && (
        <View style={styles.newIndicator} />
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  customerColumn: {
    minWidth: 120,
    maxWidth: 240,
    marginRight: 30,
  },
  customerName: {
    fontSize: 15,
    fontWeight: '500',
  },
  typeColumn: {
    width: 100,
    marginRight: 30,
  },
  typeText: {
    fontSize: 14,
  },
  printedColumn: {
    width: 85,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 20,
  },
  printedYes: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#dcfce7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  printedYesText: {
    color: '#16a34a',
    fontSize: 16,
    fontWeight: '700',
  },
  printedNo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fee2e2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  printedNoText: {
    color: '#dc2626',
    fontSize: 18,
    fontWeight: '400',
  },
  timeColumn: {
    width: 100,
    alignItems: 'flex-end',
  },
  timeText: {
    fontSize: 13,
  },
  newIndicator: {
    position: 'absolute',
    left: 4,
    top: '50%',
    marginTop: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
  },
});

export default OrderListItem;
