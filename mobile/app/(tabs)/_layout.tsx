// ─────────────────────────────────────────────────────────────────────────────
//  app/(tabs)/_layout.tsx — 5-tab layout matching Figma design
//  Tabs: בית | אקספלורר | תביעות | הודעות | פרופיל
// ─────────────────────────────────────────────────────────────────────────────
import { Tabs } from 'expo-router';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, typography, glass } from '@/theme';

function TabIcon({ icon, focused, badge }: { icon: string; focused: boolean; badge?: number }) {
  return (
    <View style={{ alignItems: 'center', gap: 1, position: 'relative' }}>
      <View style={{
        width: 34, height: 34, borderRadius: 11,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: focused ? colors.primaryGlow : 'transparent',
      }}>
        <Text style={{ fontSize: 19 }}>{icon}</Text>
      </View>
      {badge !== undefined && badge > 0 && (
        <View style={{
          position: 'absolute', top: -2, right: -6,
          minWidth: 16, height: 16, borderRadius: 8,
          backgroundColor: colors.danger,
          alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: 3,
        }}>
          <Text style={{ fontSize: 9, color: '#FFF', fontWeight: '800' }}>{badge}</Text>
        </View>
      )}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:   colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarLabelStyle: {
          ...typography.labelSm,
          marginBottom: Platform.OS === 'ios' ? 0 : 4,
          fontSize: 10,
          fontWeight: '500',
        },
        tabBarStyle: {
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          height: Platform.OS === 'ios' ? 88 : 68,
          paddingTop: 6,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
          borderTopWidth: 0,
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : 'rgba(255,255,255,0.92)',
          elevation: 0,
          ...Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.05,
              shadowRadius: 12,
            },
            android: { elevation: 8 },
          }),
        },
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView intensity={70} tint="light" style={StyleSheet.absoluteFill} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'בית',
          tabBarIcon: ({ focused }) => <TabIcon icon="🏠" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'אקספלורר',
          tabBarIcon: ({ focused }) => <TabIcon icon="🧭" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="claims"
        options={{
          title: 'תביעות',
          tabBarIcon: ({ focused }) => <TabIcon icon="📄" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'הודעות',
          tabBarIcon: ({ focused }) => <TabIcon icon="✉️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'פרופיל',
          tabBarIcon: ({ focused }) => <TabIcon icon="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
