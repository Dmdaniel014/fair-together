// ─────────────────────────────────────────────────────────────────────────────
//  GlassCard.tsx — Liquid Glass card component
//  Premium translucent card with blur background and subtle borders
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, ViewStyle, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { glass, radius, shadows, colors } from '../theme';

interface GlassCardProps {
  children:     React.ReactNode;
  style?:       ViewStyle;
  variant?:     'default' | 'light' | 'solid' | 'accent';
  accentColor?: string;
  noPadding?:   boolean;
  blurIntensity?: number;
}

export default function GlassCard({
  children,
  style,
  variant = 'default',
  accentColor,
  noPadding,
  blurIntensity,
}: GlassCardProps) {
  const intensity = blurIntensity ?? glass.blurIntensity;

  const containerStyle: ViewStyle = {
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.glass,
    ...(variant === 'accent' && accentColor ? {
      borderWidth: 1.5,
      borderColor: `${accentColor}35`,
    } : {
      borderWidth: 1,
      borderColor: colors.glassBorder,
    }),
    ...style,
  };

  const innerPadding = noPadding ? {} : { padding: 16 };

  // BlurView works best on iOS. On Android, fall back to semi-transparent bg.
  if (Platform.OS === 'ios') {
    return (
      <View style={containerStyle}>
        <BlurView
          intensity={intensity}
          tint={glass.blurTint}
          style={[StyleSheet.absoluteFill]}
        />
        {/* Subtle white overlay for the glass tint */}
        <View style={[StyleSheet.absoluteFill, {
          backgroundColor: variant === 'solid' ? colors.glassDark
            : variant === 'light' ? colors.glassLight
            : colors.glass,
        }]} />
        {/* Accent top line */}
        {accentColor && (
          <View style={{ height: 3, backgroundColor: accentColor }} />
        )}
        <View style={innerPadding}>
          {children}
        </View>
      </View>
    );
  }

  // Android fallback: solid glass-like background without blur
  return (
    <View style={[containerStyle, {
      backgroundColor: variant === 'solid' ? colors.glassDark
        : variant === 'light' ? 'rgba(255, 255, 255, 0.88)'
        : 'rgba(255, 255, 255, 0.82)',
    }]}>
      {accentColor && (
        <View style={{ height: 3, backgroundColor: accentColor }} />
      )}
      <View style={innerPadding}>
        {children}
      </View>
    </View>
  );
}
