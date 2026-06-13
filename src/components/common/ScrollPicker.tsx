import React, { useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
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
  // True for the WHOLE user gesture, including fling momentum, so the re-center
  // effect never fires mid-scroll and snaps/kills it. Cleared only when the
  // gesture fully settles (momentum end, or drag-end with no momentum).
  const isScrolling = useRef(false);
  const momentumActive = useRef(false);

  // Pad with empty items so the selected item can be centered
  const padded = ['', ...items, ''];

  useEffect(() => {
    // Re-center only on a PROGRAMMATIC selectedIndex change (parent set the
    // value, e.g. reopening the meetup sheet). While the user is scrolling the
    // list is already at the right offset; re-scrolling would fight the gesture.
    // No remembered-index guard here, so a programmatic reset always re-syncs
    // even if a prior fling left the list offset drifted.
    if (!isScrolling.current) {
      flatListRef.current?.scrollToOffset({ offset: selectedIndex * ITEM_HEIGHT, animated: false });
    }
  }, [selectedIndex]);

  const selectFromOffset = useCallback((offsetY: number) => {
    const index = Math.round(offsetY / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    if (clamped !== selectedIndex) onSelect(clamped);
  }, [items.length, selectedIndex, onSelect]);

  const handleScrollBegin = useCallback(() => {
    isScrolling.current = true;
    momentumActive.current = false;
  }, []);

  const handleMomentumScrollBegin = useCallback(() => {
    momentumActive.current = true;
  }, []);

  const handleMomentumScrollEnd = useCallback((e: any) => {
    momentumActive.current = false;
    isScrolling.current = false;
    selectFromOffset(e.nativeEvent.contentOffset.y);
  }, [selectFromOffset]);

  const handleScrollEndDrag = useCallback((e: any) => {
    // iOS fires onMomentumScrollEnd ONLY after a fling. A slow drag-and-release
    // (carefully dialing a time) ends here with no momentum, so we must commit
    // the selection. But a fling ALSO fires this at finger-release (mid-fling,
    // wrong value) just before momentum starts — defer a frame and let
    // onMomentumScrollBegin claim it, so we don't commit a wrong mid-fling value
    // and we keep isScrolling true through the fling.
    const offsetY = e.nativeEvent.contentOffset.y;
    requestAnimationFrame(() => {
      if (!momentumActive.current) {
        isScrolling.current = false;
        selectFromOffset(offsetY);
      }
    });
  }, [selectFromOffset]);

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
        onMomentumScrollBegin={handleMomentumScrollBegin}
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
