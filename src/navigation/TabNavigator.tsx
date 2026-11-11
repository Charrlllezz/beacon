import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Platform, View } from 'react-native';
import { BlurView } from 'expo-blur';
import type { SFSymbol } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../config/theme';
import Icon, { Effects } from '../components/ui/Icon';
import ChatScreen from '../screens/ChatScreen';
import MapScreen from '../screens/MapScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import CrewScreen from '../screens/CrewScreen';
import { festivalConfig } from '../services/festival/FestivalConfig';

const Tab = createBottomTabNavigator();

// Rounded-outline SF Symbol, filled and in the accent when its tab is open.
function tabIcon(name: SFSymbol) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <Icon name={name} size={23} color={color} filled={focused} weight={focused ? 'semibold' : 'regular'} animation={focused ? Effects.bounce : undefined} />
  );
}

function TabBarBackground() {
  return (
    <View style={StyleSheet.absoluteFill}>
      <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.glass }]} />
    </View>
  );
}

export default function TabNavigator() {
  const insets = useSafeAreaInsets();
  // Grow the tab bar with the device's home-indicator inset so it's never
  // hidden under the home indicator on devices like iPhone 16 Pro Max.
  const bottomPad = Platform.OS === 'ios' ? Math.max(insets.bottom, 10) : 10;
  const tabBarHeight = Platform.OS === 'ios' ? 56 + bottomPad : 68;
  // No Lineup tab until the festival's set times are in the config: an empty
  // tab with dead controls is worse than none. The navigator is keyed on the
  // festival (App.tsx), so this re-checks when the festival changes.
  const hasLineup = festivalConfig.getAllStages().some(s => s.schedule.length > 0);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: [styles.tabBar, { paddingBottom: bottomPad, height: tabBarHeight }],
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        tabBarBackground: () => <TabBarBackground />,
      }}
      // Crew opens first: "where is everyone?" is the question at a festival.
      initialRouteName="Crew"
    >
      <Tab.Screen
        name="Crew"
        component={CrewScreen}
        options={{
          tabBarAccessibilityLabel: 'Crew',
          tabBarIcon: tabIcon('person.2'),
        }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          tabBarAccessibilityLabel: 'Chat',
          tabBarIcon: tabIcon('bubble.left.and.bubble.right'),
        }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          tabBarAccessibilityLabel: 'Map',
          tabBarIcon: tabIcon('map'),
        }}
      />
      {hasLineup && <Tab.Screen
        name="Lineup"
        component={ScheduleScreen}
        options={{
          tabBarAccessibilityLabel: 'Lineup',
          tabBarIcon: tabIcon('music.note.list'),
        }}
      />}
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: 'transparent',
    borderTopColor: Colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  tabLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
  },
  tabItem: { paddingTop: 4 },
});
