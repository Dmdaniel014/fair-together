// ─────────────────────────────────────────────────────────────────────────────
//  Card.tsx — Fair Together · Design System primitive
//  White card container with optional accent stripe on the right (RTL leading edge).
//  Ported from design-package Primitives.jsx → Card.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Pressable, View, ViewStyle, StyleProp } from 'react-native';
import { colors, radius, shadows } from '@/theme';

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  /** Right-edge accent stripe (RTL leading edge). e.g. theme `colors.success`. */
  accent?: string;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;   // default true
  testID?: string;
}

export function Card({
  children,
  onPress,
  accent,
  style,
  padded = true,
  testID,
}: CardProps) {
  const base: ViewStyle = {
    backgroundColor: colors.bgWhite,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderDim,
    padding: padded ? 16 : 0,
    position: 'relative',
    overflow: 'hidden',
    ...shadows.card,
  };

  const body = (
    <>
      {accent ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0, // RTL leading edge
            bottom: 0,
            width: 3,
            backgroundColor: accent,
          }}
        />
      ) : null}
      {children}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [
          base,
          pressed ? { transform: [{ scale: 0.995 }], opacity: 0.97 } : null,
          style,
        ]}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View testID={testID} style={[base, style]}>
      {body}
    </View>
  );
}
