import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Order } from '../../types';
import { useTheme } from '../../theme';

interface OrderListItemProps {
  order: Order;
  isSelected: boolean;
  isPrinted: boolean;
  isBacklogged?: boolean;
  orderAgingEnabled?: boolean;
  onPress: () => void;
  // Simplified view props
  simplifiedView?: boolean;
  onQuickMarkReady?: (orderId: string) => void;
}

// Calculate order age in minutes
const getOrderAgeMinutes = (createdAt: string): number => {
  const created = new Date(createdAt);
  const now = new Date();
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60));
};

// Get aging color based on order age
const getAgingColor = (ageMinutes: number, themeMode: string): { bg: string; border: string } | null => {
  if (ageMinutes >= 10) {
    // RED - Order is old/late
    return {
      bg: themeMode === 'dark' ? '#450a0a' : '#fef2f2',
      border: '#ef4444',
    };
  } else if (ageMinutes >= 5) {
    // YELLOW - Order is getting old
    return {
      bg: themeMode === 'dark' ? '#422006' : '#fefce8',
      border: '#eab308',
    };
  }
  // GREEN/Normal - Order is fresh (no special coloring needed, default is fine)
  return null;
};

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
  isBacklogged = false,
  orderAgingEnabled = false,
  onPress,
  simplifiedView = false,
  onQuickMarkReady,
}) => {
  const { theme, themeMode } = useTheme();
  const customerName = order.customer?.name || 'Walk-in';
  const orderType = order.order_type || 'pickup';
  
  // Calculate order age for color coding
  const orderAgeMinutes = getOrderAgeMinutes(order.created_at);
  const agingColors = orderAgingEnabled && !isPrinted && order.status === 'pending' 
    ? getAgingColor(orderAgeMinutes, themeMode) 
    : null;
  
  const colors = {
    bg: themeMode === 'dark' ? '#1e293b' : '#ffffff',
    bgSelected: themeMode === 'dark' ? '#1e3a5f' : '#eff6ff',
    bgBacklogged: themeMode === 'dark' ? '#422006' : '#fef3c7', // Amber/warning background
    text: theme.text,
    textSecondary: theme.textSecondary,
    textMuted: theme.textMuted,
    border: themeMode === 'dark' ? '#334155' : '#e2e8f0',
  };
  
  // Determine background color: backlogged > aging > selected > default
  let bgColor = colors.bg;
  let leftBorderColor: string | undefined = undefined;
  
  if (isBacklogged) {
    bgColor = colors.bgBacklogged;
  } else if (agingColors) {
    bgColor = agingColors.bg;
    leftBorderColor = agingColors.border;
  } else if (isSelected) {
    bgColor = colors.bgSelected;
  }
  
  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: bgColor, borderBottomColor: colors.border },
        isBacklogged && styles.containerBacklogged,
        leftBorderColor && { borderLeftWidth: 4, borderLeftColor: leftBorderColor },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Backlogged indicator (warning icon) */}
      {isBacklogged && (
        <View style={styles.backlogIndicator}>
          <Text style={styles.backlogIndicatorText}>⚠️</Text>
        </View>
      )}
      
      {/* Customer Column */}
      <View style={styles.customerColumn}>
        <Text style={[styles.customerName, { color: colors.text }]} numberOfLines={1}>
          {customerName}
        </Text>
        {isBacklogged && (
          <Text style={styles.backlogLabel}>NEEDS PRINT</Text>
        )}
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
      
      {/* Quick Mark Ready Button - Only in simplified view for non-ready orders */}
      {simplifiedView && order.status !== 'ready' && onQuickMarkReady && (
        <TouchableOpacity
          style={styles.quickReadyButton}
          onPress={() => onQuickMarkReady(order.id)}
        >
          <Text style={styles.quickReadyText}>Ready ✓</Text>
        </TouchableOpacity>
      )}
      
      {/* New order indicator dot (not shown for backlogged - they have their own indicator) */}
      {!isPrinted && !isBacklogged && order.status === 'pending' && (
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
  // Backlogged order styles
  containerBacklogged: {
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b', // Amber color for warning
  },
  backlogIndicator: {
    marginRight: 8,
  },
  backlogIndicatorText: {
    fontSize: 18,
  },
  backlogLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#d97706', // Amber-600
    marginTop: 2,
    letterSpacing: 0.5,
  },
  // Quick Mark Ready button for simplified view
  quickReadyButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    marginLeft: 12,
  },
  quickReadyText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});

export default OrderListItem;
