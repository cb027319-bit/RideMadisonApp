import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { FONT } from '@/lib/config';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

export default function TabLayout() {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textFaint,
        tabBarActiveBackgroundColor: 'transparent',
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: FONT.black, fontSize: 20 },
        tabBarLabelStyle: { fontSize: 12, fontFamily: FONT.bold },
        sceneStyle: { backgroundColor: c.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('map.tab.map'),
          headerShown: false,
          tabBarAccessibilityLabel: t('map.tab.mapA11y'),
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="route"
        options={{
          title: t('map.tab.route'),
          headerShown: false,
          tabBarAccessibilityLabel: t('map.tab.routeA11y'),
          tabBarIcon: ({ color, size }) => <Ionicons name="navigate" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="nearby"
        options={{
          title: t('map.tab.nearby'),
          headerTitle: t('map.tab.nearby'),
          tabBarIcon: ({ color, size }) => <Ionicons name="location" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: t('events.tab'),
          headerTitle: t('events.tab'),
          tabBarAccessibilityLabel: t('events.tabA11y'),
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="about"
        options={{
          title: t('map.tab.more'),
          headerTitle: t('map.tab.more'),
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal-circle" size={size} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
