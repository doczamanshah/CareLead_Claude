import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home',
  tasks: 'checkmark-circle',
  documents: 'document-text',
  household: 'people',
  settings: 'settings',
};

const TAB_ICONS_OUTLINE: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home-outline',
  tasks: 'checkmark-circle-outline',
  documents: 'document-text-outline',
  household: 'people-outline',
  settings: 'settings-outline',
};

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary.DEFAULT,
        tabBarInactiveTintColor: COLORS.text.tertiary,
        tabBarStyle: {
          backgroundColor: COLORS.surface.DEFAULT,
          borderTopColor: COLORS.border.DEFAULT,
          paddingBottom: 4,
          height: 56,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? TAB_ICONS.index : TAB_ICONS_OUTLINE.index}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? TAB_ICONS.tasks : TAB_ICONS_OUTLINE.tasks}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: 'Documents',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? TAB_ICONS.documents : TAB_ICONS_OUTLINE.documents}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="household"
        options={{
          title: 'Household',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? TAB_ICONS.household : TAB_ICONS_OUTLINE.household}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? TAB_ICONS.settings : TAB_ICONS_OUTLINE.settings}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
