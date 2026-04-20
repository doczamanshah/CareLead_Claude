import { useMemo } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { TYPOGRAPHY } from '@/lib/constants/design';
import type { ThemePalette } from '@/lib/constants/themes';

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
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => buildStyles(colors), [colors]);
  // In dark mode, primary is already the lighter variant so it contrasts
  // against the dark tab bar. In light mode we use the default dark green.
  const activeTint = isDark ? colors.primary.lighter : colors.primary.DEFAULT;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: colors.text.tertiary,
        sceneStyle: { backgroundColor: colors.background.DEFAULT },
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

function buildStyles(colors: ThemePalette) {
  return StyleSheet.create({
    tabBar: {
      backgroundColor: colors.background.card,
      borderTopColor: colors.border.light,
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
}
