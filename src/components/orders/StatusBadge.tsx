import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export type OrderStatusType = 'new' | 'pending' | 'in_progress' | 'preparing' | 'ready' | 'completed' | 'picked_up' | 'delivered' | 'cancelled';

interface StatusBadgeProps {
  status: OrderStatusType | string;
  size?: 'small' | 'medium' | 'large';
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; dotColor: string }> = {
  new: { label: 'New', color: '#3b82f6', bgColor: '#1e3a5f', dotColor: '#3b82f6' },
  pending: { label: 'New', color: '#3b82f6', bgColor: '#1e3a5f', dotColor: '#3b82f6' },
  active: { label: 'Active', color: '#f59e0b', bgColor: '#422006', dotColor: '#f59e0b' },
  in_progress: { label: 'Active', color: '#f59e0b', bgColor: '#422006', dotColor: '#f59e0b' },
  preparing: { label: 'Active', color: '#f59e0b', bgColor: '#422006', dotColor: '#f59e0b' },
  ready: { label: 'Ready', color: '#22c55e', bgColor: '#14532d', dotColor: '#22c55e' },
  completed: { label: 'Picked Up', color: '#6b7280', bgColor: '#1f2937', dotColor: '#6b7280' },
  picked_up: { label: 'Picked Up', color: '#6b7280', bgColor: '#1f2937', dotColor: '#6b7280' },
  delivered: { label: 'Delivered', color: '#6b7280', bgColor: '#1f2937', dotColor: '#6b7280' },
  cancelled: { label: 'Cancelled', color: '#ef4444', bgColor: '#450a0a', dotColor: '#ef4444' },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'medium' }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  
  const sizeStyles = {
    small: { paddingH: 8, paddingV: 4, fontSize: 11, dotSize: 6 },
    medium: { paddingH: 12, paddingV: 6, fontSize: 13, dotSize: 8 },
    large: { paddingH: 16, paddingV: 8, fontSize: 15, dotSize: 10 },
  };
  
  const s = sizeStyles[size];
  
  return (
    <View style={[
      styles.badge,
      {
        backgroundColor: config.bgColor,
        paddingHorizontal: s.paddingH,
        paddingVertical: s.paddingV,
      }
    ]}>
      <View style={[
        styles.dot,
        {
          backgroundColor: config.dotColor,
          width: s.dotSize,
          height: s.dotSize,
          borderRadius: s.dotSize / 2,
        }
      ]} />
      <Text style={[
        styles.label,
        {
          color: config.color,
          fontSize: s.fontSize,
        }
      ]}>
        {config.label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  dot: {
    marginRight: 6,
  },
  label: {
    fontWeight: '600',
  },
});

export default StatusBadge;

