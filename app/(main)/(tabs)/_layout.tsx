import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet } from 'react-native';
import { COLORS } from '@/lib/constants/colors';
import { TYPOGRAPHY } from '@/lib/constants/design';

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home',
  health: 'heart',
  activity: 'checkmark-circle',
  documents: 'folder',
  ask: 'chatbubble-ellipses',
};

const TAB_ICONS_OUTLINE: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home-outline',
  health: 'heart-outline',
  activity: 'checkmark-circle-outline',
  documents: 'folder-outline',
  ask: 'chatbubble-ellipses-outline',
};

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary.DEFAULT,
        tabBarInactiveTintColor: COLORS.text.tertiary,
        sceneStyle: { backgroundColor: COLORS.background.DEFAULT },
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        tabBarLabelPosition: 'below-icon',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? TAB_ICONS.index : TAB_ICONS_OUTLINE.index}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="health"
        options={{
          title: 'Health',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? TAB_ICONS.health : TAB_ICONS_OUTLINE.health}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? TAB_ICONS.activity : TAB_ICONS_OUTLINE.activity}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: 'Documents',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? TAB_ICONS.documents : TAB_ICONS_OUTLINE.documents}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="ask"
        options={{
          title: 'Ask',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? TAB_ICONS.ask : TAB_ICONS_OUTLINE.ask}
              size={24}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.background.card,
    borderTopColor: COLORS.border.light,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: Platform.OS === 'ios' ? 84 : 60,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 28 : 6,
    elevation: 0,
    shadowOpacity: 0,
  },
  label: {
    ...TYPOGRAPHY.caption,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  item: {
    paddingVertical: 4,
  },
});
