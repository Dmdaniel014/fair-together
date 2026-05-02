// ─────────────────────────────────────────────────────────────────────────────
//  Button.tsx — Fair Together · Design System primitive
//  Ported from design-package Primitives.jsx → Button.
//  Variants: primary · secondary · ghost · destructive · success
//  Sizes:    sm · md · lg
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import {
  Pressable,
  Text,
  View,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import { colors, radius, shadows, typography } from '@/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'success';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;          // leading icon (renders on the right in RTL)
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
  testID?: string;
}

const SIZE_MAP: Record<Size, { height: number; paddingH: number; radius: number; font: TextStyle }> = {
  sm: { height: 36, paddingH: 14, radius: radius.md, font: { ...typography.labelMd } },
  md: { height: 48, paddingH: 22, radius: radius.lg, font: { ...typography.labelLg } },
  lg: { height: 52, paddingH: 28, radius: radius.lg, font: { ...typography.button } },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  loading = false,
  style,
  fullWidth,
  testID,
}: ButtonProps) {
  const s = SIZE_MAP[size];
  const palette = getPalette(variant);

  const containerStyle: ViewStyle = {
    height: s.height,
    paddingHorizontal: s.paddingH,
    borderRadius: s.radius,
    backgroundColor: palette.bg,
    borderWidth: palette.borderColor ? 1 : 0,
    borderColor: palette.borderColor,
    opacity: disabled ? 0.55 : 1,
    flexDirection: 'row-reverse', // icon on the right in RTL
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: fullWidth ? 'stretch' : 'flex-start',
    ...(palette.shadow ? shadows.button : {}),
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      testID={testID}
      style={({ pressed }) => [
        containerStyle,
        pressed && !disabled && !loading ? { transform: [{ scale: 0.985 }], opacity: 0.92 } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <View style={{ marginStart: 2 }}>{icon}</View> : null}
          <Text style={[s.font, { color: palette.fg, textAlign: 'center' }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

function getPalette(v: Variant): {
  bg: string;
  fg: string;
  borderColor?: string;
  shadow?: boolean;
} {
  switch (v) {
    case 'primary':
      return { bg: colors.primary, fg: colors.textOnPrimary, shadow: true };
    case 'success':
      return { bg: colors.success, fg: '#FFFFFF', shadow: true };
    case 'destructive':
      return { bg: colors.danger, fg: '#FFFFFF', shadow: true };
    case 'secondary':
      return { bg: colors.bgWhite, fg: colors.textPrimary, borderColor: colors.borderDefault };
    case 'ghost':
      return { bg: 'transparent', fg: colors.primary };
  }
}

// Legacy helper for places that still import a style bundle
export const buttonStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
});
