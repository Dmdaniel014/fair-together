// ─────────────────────────────────────────────────────────────────────────────
//  Pill.tsx — Fair Together · Design System primitive
//  Inline status / filter pill with optional leading icon.
//  Ported from design-package Primitives.jsx → Pill.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Pressable, Text, View, ViewStyle, StyleProp } from 'react-native';
import { colors, radius, typography } from '@/theme';

interface PillProps {
  label: string;
  color?: string;              // content color (default slate)
  bg?: string;                 // background when inactive (default bgPanel)
  active?: boolean;            // filled variant
  icon?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function Pill({
  label,
  color = colors.textTertiary,
  bg,
  active = false,
  icon,
  onPress,
  style,
}: PillProps) {
  const pillColor = color;
  const bgColor = active ? pillColor : bg || colors.bgPanel;
  const fgColor = active ? '#FFFFFF' : pillColor;

  const content = (
    <View
      style={[
        {
          flexDirection: 'row-reverse', // icon on right
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: radius.pill,
          backgroundColor: bgColor,
          borderWidth: active ? 0 : 1,
          borderColor: active ? 'transparent' : pillColor + '30',
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      {icon ? <View>{icon}</View> : null}
      <Text style={[typography.labelSm, { color: fgColor, fontSize: 12 }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed ? { opacity: 0.7 } : null}>
        {content}
      </Pressable>
    );
  }
  return content;
}
