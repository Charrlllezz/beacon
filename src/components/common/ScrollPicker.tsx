import React, { useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ViewToken } from 'react-native';
import { Colors, FontSize } from '../../config/theme';

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 3;

interface Props {
  items: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  width?: number;
  color?: string;
}

export default function ScrollPicker({ items, selectedIndex, onSelect, width = 54, color = Colors.warning }: Props) {
  const flatListRef = useRef<FlatList>(null);
  const isScrolling = useRef(false);

  // Pad with empty items so the selected item can be centered
  const padded = ['', ...items, ''];

  useEffect(() => {
    if (!isScrolling.current) {
      flatListRef.current?.scrollToOffset({ offset: selectedIndex * ITEM_HEIGHT, animated: false });
    }
  }, [selectedIndex]);

  const handleViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    // The center item (accounting for padding) is the selected one
    const center = viewableItems.find(v => v.index === selectedIndex + 1);
    // Don't update during programmatic scrolls
  }, [selectedIndex]);

  // iOS fires onMomentumScrollEnd ONLY after a fling. A slow drag-and-release —
  // how you carefully dial in a time — ends with onScrollEndDrag and no momentum
  // event, so the selection never registered. Handle both paths.
  const selectFromOffset = useCallback((offsetY: number) => {
    isScrolling.current = false;
    const index = Math.round(offsetY / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    if (clamped !== selectedIndex) onSelect(clamped);
  }, [items.length, selectedIndex, onSelect]);

  const handleMomentumScrollEnd = useCallback((e: any) => {
    selectFromOffset(e.nativeEvent.contentOffset.y);
  }, [selectFromOffset]);

  const handleScrollEndDrag = useCallback((e: any) => {
    selectFromOffset(e.nativeEvent.contentOffset.y);
  }, [selectFromOffset]);

  const handleScrollBegin = useCallback(() => {
    isScrolling.current = true;
  }, []);

  return (
    <View style={[styles.container, { width, height: ITEM_HEIGHT * VISIBLE_ITEMS }]}>
      {/* Selection highlight */}
      <View style={[styles.highlight, { borderColor: color + '44' }]} pointerEvents="none" />
      <FlatList
        ref={flatListRef}
        data={padded}
        keyExtractor={(_, i) => `${i}`}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onScrollBeginDrag={handleScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScrollEndDrag={handleScrollEndDrag}
        getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
        renderItem={({ item, index }) => {
          const dataIndex = index - 1; // account for top padding
          const isSelected = dataIndex === selectedIndex;
          return (
            <View style={styles.item}>
              <Text style={[
                styles.itemText,
                isSelected && { color, fontWeight: '800', fontSize: 30 },
                !item && styles.itemTextEmpty,
              ]}>
                {item}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: ITEM_HEIGHT,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    zIndex: 1,
  },
  item: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    fontSize: 22,
    fontWeight: '600',
    color: Colors.textMuted,
    fontFamily: 'monospace',
  },
  itemTextEmpty: {
    color: 'transparent',
  },
});
