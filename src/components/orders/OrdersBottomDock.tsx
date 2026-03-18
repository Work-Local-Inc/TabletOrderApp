import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';

interface OrdersBottomDockProps {
  restaurantName: string;
  locationLogoUrl?: string | null;
  viewMode?: string;
  counts?: Record<string, number>;
  isOnline?: boolean;
  printerConnected?: boolean;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  recall?: {
    enabled: boolean;
    archivedCount: number;
    active: boolean;
    onToggle: () => void;
  };
}

export const OrdersBottomDock: React.FC<OrdersBottomDockProps> = ({
  restaurantName,
  isOnline = true,
  printerConnected = false,
  onOpenSettings,
  onRefresh,
  recall,
}) => {
  const { theme: colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.dock, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.left}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{restaurantName}</Text>
        <View style={styles.indicators}>
          <View style={[styles.dot, { backgroundColor: isOnline ? '#22c55e' : '#ef4444' }]} />
          <Text style={[styles.label, { color: colors.textMuted }]}>{isOnline ? 'Online' : 'Offline'}</Text>
          <View style={[styles.dot, { backgroundColor: printerConnected ? '#22c55e' : '#ef4444', marginLeft: 8 }]} />
          <Text style={[styles.label, { color: colors.textMuted }]}>{printerConnected ? 'Printer' : 'No Printer'}</Text>
        </View>
      </View>
      <View style={styles.right}>
        {recall?.enabled && (
          <TouchableOpacity style={[styles.btn, recall.active && styles.btnActive]} onPress={recall.onToggle}>
            <Text style={styles.btnText}>{recall.active ? 'Exit Recall' : `Recall (${recall.archivedCount})`}</Text>
          </TouchableOpacity>
        )}
        {onRefresh && (
          <TouchableOpacity style={styles.btn} onPress={onRefresh}>
            <Text style={styles.btnText}>Refresh</Text>
          </TouchableOpacity>
        )}
        {onOpenSettings && (
          <TouchableOpacity style={styles.btn} onPress={onOpenSettings}>
            <Text style={styles.btnText}>Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  dock: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1 },
  left: { flex: 1 },
  name: { fontSize: 14, fontWeight: '600' },
  indicators: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 11, marginLeft: 4 },
  right: { flexDirection: 'row', gap: 8 },
  btn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 6 },
  btnActive: { backgroundColor: '#3b82f6' },
  btnText: { fontSize: 12, fontWeight: '500' },
});
