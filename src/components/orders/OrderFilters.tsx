import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';

export type FilterStatus = 'all' | 'new' | 'active' | 'ready' | 'completed' | 'simplified_new' | 'simplified_ready';

interface OrderFiltersProps {
  selectedFilter: FilterStatus;
  onFilterChange: (filter: FilterStatus) => void;
  onRefresh?: () => void;
  counts: {
    all: number;
    new: number;
    active: number;
    ready: number;
    completed: number;
    simplified_new?: number; // pending + confirmed + preparing
    simplified_ready?: number; // ready + completed + cancelled
  };
  simplifiedView?: boolean;
}

const FILTERS: { key: FilterStatus; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'active', label: 'Active' },
  { key: 'ready', label: 'Ready' },
  { key: 'completed', label: 'Completed' },
];

// Simplified filters with status indicator colors
const SIMPLIFIED_FILTERS: { key: FilterStatus; label: string; dotColor: string }[] = [
  { key: 'simplified_new', label: 'New', dotColor: '#f59e0b' },       // Amber - incoming/active
  { key: 'simplified_ready', label: 'Complete', dotColor: '#10b981' }, // Green - done
];

export const OrderFilters: React.FC<OrderFiltersProps> = ({
  selectedFilter,
  onFilterChange,
  onRefresh,
  counts,
  simplifiedView = false,
}) => {
  const { theme, themeMode } = useTheme();
  
  const colors = {
    bg: themeMode === 'dark' ? '#16213e' : '#ffffff',
    text: themeMode === 'dark' ? '#94a3b8' : '#64748b',
    textActive: themeMode === 'dark' ? '#ffffff' : '#1e293b',
    underline: '#3b82f6',
    border: themeMode === 'dark' ? '#334155' : '#e2e8f0',
    refreshBg: themeMode === 'dark' ? '#1e293b' : '#f1f5f9',
    // Simplified view pill backgrounds
    pillBg: themeMode === 'dark' ? '#1e293b' : '#f1f5f9',
    pillBgActive: themeMode === 'dark' ? '#334155' : '#e2e8f0',
  };

  // Render simplified view with pill-style tabs
  if (simplifiedView) {
    return (
      <View style={[styles.container, styles.containerSimplified, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}>
        <View style={styles.pillGroup}>
          {SIMPLIFIED_FILTERS.map((filter) => {
            const isSelected = selectedFilter === filter.key;
            const count = counts[filter.key as keyof typeof counts] ?? 0;
            
            return (
              <TouchableOpacity
                key={filter.key}
                style={[
                  styles.pillButton,
                  { backgroundColor: isSelected ? colors.pillBgActive : colors.pillBg },
                  isSelected && styles.pillButtonActive,
                ]}
                onPress={() => onFilterChange(filter.key)}
                activeOpacity={0.7}
              >
                {/* Status indicator dot */}
                <View style={[styles.statusDot, { backgroundColor: filter.dotColor }]} />
                <Text style={[
                  styles.pillLabel,
                  { color: isSelected ? colors.textActive : colors.text },
                  isSelected && styles.pillLabelActive,
                ]}>
                  {filter.label}
                </Text>
                {count > 0 && (
                  <View style={[styles.countBadge, { backgroundColor: isSelected ? filter.dotColor : colors.text + '30' }]}>
                    <Text style={[styles.countBadgeText, { color: isSelected ? '#fff' : colors.text }]}>
                      {count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        
        {/* Refresh button */}
        <View style={styles.spacer} />
        {onRefresh && (
          <TouchableOpacity 
            style={[styles.refreshButtonSimplified, { backgroundColor: colors.pillBg }]} 
            onPress={onRefresh}
            activeOpacity={0.7}
          >
            <Text style={[styles.refreshText, { color: colors.text }]}>Refresh</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // Standard 4-tab view
  return (
    <View style={[styles.container, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}>
      {FILTERS.map((filter) => {
        const isSelected = selectedFilter === filter.key;
        const count = counts[filter.key as keyof typeof counts] ?? 0;
        
        return (
          <TouchableOpacity
            key={filter.key}
            style={styles.filterButton}
            onPress={() => onFilterChange(filter.key)}
          >
            <Text style={[
              styles.filterLabel,
              { color: isSelected ? colors.textActive : colors.text },
              isSelected && styles.filterLabelActive,
            ]}>
              {filter.label}
              {count > 0 && (
                <Text style={styles.countText}> ({count})</Text>
              )}
            </Text>
            {isSelected && (
              <View style={[styles.underline, { backgroundColor: colors.underline }]} />
            )}
          </TouchableOpacity>
        );
      })}
      
      {/* Refresh button at the end */}
      <View style={styles.spacer} />
      {onRefresh && (
        <TouchableOpacity 
          style={[styles.refreshButton, { backgroundColor: colors.refreshBg }]} 
          onPress={onRefresh}
        >
          <Text style={styles.refreshIcon}>🔄</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  containerSimplified: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  filterButton: {
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 14,
    position: 'relative',
  },
  filterLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  filterLabelActive: {
    fontWeight: '600',
  },
  countText: {
    fontWeight: '400',
  },
  underline: {
    position: 'absolute',
    bottom: 0,
    left: 14,
    right: 14,
    height: 2,
    borderRadius: 1,
  },
  spacer: {
    flex: 1,
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshIcon: {
    fontSize: 18,
  },
  // Simplified view pill styles
  pillGroup: {
    flexDirection: 'row',
    gap: 12,
  },
  pillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  pillButtonActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillLabel: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  pillLabelActive: {
    fontWeight: '600',
  },
  countBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  refreshButtonSimplified: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  refreshText: {
    fontSize: 14,
    fontWeight: '500',
  },
});

export default OrderFilters;
