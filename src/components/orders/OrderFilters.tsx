import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';

export type FilterStatus = 'all' | 'new' | 'active' | 'ready' | 'completed';

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
  };
}

const FILTERS: { key: FilterStatus; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'active', label: 'Active' },
  { key: 'ready', label: 'Ready' },
  { key: 'completed', label: 'Completed' },
];

export const OrderFilters: React.FC<OrderFiltersProps> = ({
  selectedFilter,
  onFilterChange,
  onRefresh,
  counts,
}) => {
  const { theme, themeMode } = useTheme();
  
  const colors = {
    bg: themeMode === 'dark' ? '#16213e' : '#ffffff',
    text: themeMode === 'dark' ? '#94a3b8' : '#64748b',
    textActive: themeMode === 'dark' ? '#ffffff' : '#1e293b',
    underline: '#3b82f6',
    border: themeMode === 'dark' ? '#334155' : '#e2e8f0',
    refreshBg: themeMode === 'dark' ? '#1e293b' : '#f1f5f9',
  };

  return (
    <View style={[styles.container, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}>
      {FILTERS.map((filter) => {
        const isSelected = selectedFilter === filter.key;
        const count = counts[filter.key];
        
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
});

export default OrderFilters;
