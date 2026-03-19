import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
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
  locationLogoUrl,
  isOnline = true,
  printerConnected = false,
  onOpenSettings,
  onRefresh,
  recall,
}) => {
  const { theme: colors } = useTheme();
  const insets = useSafeAreaInsets();

  const statusColor = !isOnline ? '#ef4444' : printerConnected ? '#22c55e' : '#f59e0b';

  return (
    <View style={[styles.dock, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.left}>
        {locationLogoUrl ? (
          <Image source={{ uri: locationLogoUrl }} style={styles.logo} resizeMode="contain" />
        ) : (
          <Image source={require('../../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        )}
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{restaurantName}</Text>
      </View>

      <View style={styles.right}>
        {recall?.enabled && (
          <TouchableOpacity style={[styles.btn, { backgroundColor: recall.active ? '#3b82f6' : colors.border }]} onPress={recall.onToggle}>
            <Text style={[styles.btnText, { color: recall.active ? '#fff' : colors.textMuted }]}>
              {recall.active ? 'Exit Recall' : `Recall (${recall.archivedCount})`}
            </Text>
          </TouchableOpacity>
        )}
        {onRefresh && (
          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.border }]} onPress={onRefresh}>
            <Text style={[styles.refreshText, { color: colors.textMuted }]}>↻</Text>
          </TouchableOpacity>
        )}
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        {onOpenSettings && (
          <TouchableOpacity style={[styles.gearBtn, { backgroundColor: colors.border }]} onPress={onOpenSettings}>
            <Text style={[styles.gearText, { color: colors.textMuted }]}>⚙</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  dock: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1 },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  logo: { width: 36, height: 36, borderRadius: 8 },
  name: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  btnText: { fontSize: 12, fontWeight: '600' },
  refreshText: { fontSize: 16, fontWeight: '800' },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  gearBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  gearText: { fontSize: 20 },
});

export default OrdersBottomDock;
