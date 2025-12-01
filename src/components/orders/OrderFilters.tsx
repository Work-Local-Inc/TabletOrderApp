import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export type FilterStatus = 'all' | 'new' | 'active' | 'ready' | 'completed';

interface OrderFiltersProps {
  selectedFilter: FilterStatus;
  onFilterChange: (filter: FilterStatus) => void;
  counts: {
    all: number;
    new: number;
    active: number;
    ready: number;
    completed: number;
  };
}

const FILTERS: { key: FilterStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'active', label: 'Active' },
  { key: 'ready', label: 'Ready' },
  { key: 'completed', label: 'Completed' },
];

export const OrderFilters: React.FC<OrderFiltersProps> = ({
  selectedFilter,
  onFilterChange,
  counts,
}) => {
  return (
    <View style={styles.container}>
      {FILTERS.map((filter) => {
        const isSelected = selectedFilter === filter.key;
        const count = counts[filter.key];
        
        return (
          <TouchableOpacity
            key={filter.key}
            style={[
              styles.filterButton,
              isSelected && styles.filterButtonSelected,
            ]}
            onPress={() => onFilterChange(filter.key)}
          >
            <Text style={[
              styles.filterLabel,
              isSelected && styles.filterLabelSelected,
            ]}>
              {filter.label}
            </Text>
            {count > 0 && (
              <View style={[
                styles.badge,
                isSelected && styles.badgeSelected,
                filter.key === 'new' && count > 0 && styles.badgeNew,
              ]}>
                <Text style={[
                  styles.badgeText,
                  isSelected && styles.badgeTextSelected,
                ]}>
                  {count}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    padding: 6,
    borderRadius: 12,
    marginBottom: 12,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginHorizontal: 2,
  },
  filterButtonSelected: {
    backgroundColor: '#1e293b',
  },
  filterLabel: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  filterLabelSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  badge: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 6,
    minWidth: 24,
    alignItems: 'center',
  },
  badgeSelected: {
    backgroundColor: '#475569',
  },
  badgeNew: {
    backgroundColor: '#3b82f6',
  },
  badgeText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  badgeTextSelected: {
    color: '#fff',
  },
});

export default OrderFilters;

