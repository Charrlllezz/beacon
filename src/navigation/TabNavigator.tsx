import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, StyleSheet, Platform } from 'react-native';
import { Colors } from '../config/theme';
import ChatScreen from '../screens/ChatScreen';
import MapScreen from '../screens/MapScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import CrewScreen from '../screens/CrewScreen';

const Tab = createBottomTabNavigator();

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          tabBarAccessibilityLabel: 'Chat',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 24 : 21, opacity: focused ? 1 : 0.45 }}>💬</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          tabBarAccessibilityLabel: 'Map',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 24 : 21, opacity: focused ? 1 : 0.45 }}>🗺️</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Lineup"
        component={ScheduleScreen}
        options={{
          tabBarAccessibilityLabel: 'Lineup',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 24 : 21, opacity: focused ? 1 : 0.45 }}>🎵</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Crew"
        component={CrewScreen}
        options={{
          tabBarAccessibilityLabel: 'Crew',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 24 : 21, opacity: focused ? 1 : 0.45 }}>👥</Text>
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
    height: Platform.OS === 'ios' ? 88 : 68,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  tabItem: { paddingTop: 4 },
});
