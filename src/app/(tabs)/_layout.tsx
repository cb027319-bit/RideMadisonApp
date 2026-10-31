import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { COLORS } from '@/lib/config';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.brand,
        headerTitleStyle: { fontWeight: '700' },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Map',
          headerShown: false,
          tabBarAccessibilityLabel: 'Map: bike paths, BCycle and shops',
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="route"
        options={{
          title: 'Route',
          headerShown: false,
          tabBarAccessibilityLabel: 'Route: plan a bike ride',
          tabBarIcon: ({ color, size }) => <Ionicons name="navigate" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="nearby"
        options={{
          title: 'Nearby',
          headerTitle: 'Nearby',
          tabBarIcon: ({ color, size }) => <Ionicons name="location" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="about"
        options={{
          title: 'More',
          headerTitle: 'More',
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal-circle" size={size} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
