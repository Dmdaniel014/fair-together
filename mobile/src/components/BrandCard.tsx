// ─────────────────────────────────────────────────────────────
//  BrandCard.tsx
//  Figma frame: "Brand Selector" — node pending MCP diff
//  NativeWind v4 + React Native
// ─────────────────────────────────────────────────────────────
import React from 'react';
import { Pressable, View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { colors, typography, radius, spacing } from '../theme';

export interface BrandData {
  slug:        string;
  nameEn:      string;
  nameHe:      string;
  initial:     string;
  brandColor:  string;   // hex — per-brand primary
  category:    'Supermarket' | 'Manufacturer' | 'Convenience';
}

interface BrandCardProps {
  brand:      BrandData;
  selected:   boolean;
  onToggle:   (slug: string) => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function BrandCard({ brand, selected, onToggle }: BrandCardProps) {
  const pressed  = useSharedValue(0);
  const isSelected = useSharedValue(selected ? 1 : 0);

  // Sync external selected state → animation value
  React.useEffect(() => {
    isSelected.value = withSpring(selected ? 1 : 0, { damping: 18, stiffness: 200 });
  }, [selected]);

  // Parse brand hex → rgb for animated fill
  const hex = brand.brandColor.replace('#', '');
  const r   = parseInt(hex.slice(0, 2), 16);
  const g   = parseInt(hex.slice(2, 4), 16);
  const b   = parseInt(hex.slice(4, 6), 16);

  const cardStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      isSelected.value,
      [0, 1],
      [colors.bgCard, `rgba(${r},${g},${b},0.10)`]
    ),
    borderColor: interpolateColor(
      isSelected.value,
      [0, 1],
      [colors.borderDim, brand.brandColor]
    ),
    transform: [
      { scale: withSpring(pressed.value ? 0.95 : 1, { damping: 20 }) },
    ],
  }));

  const logoStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      isSelected.value,
      [0, 1],
      [colors.bgPanel, brand.brandColor]
    ),
  }));

  const checkStyle = useAnimatedStyle(() => ({
    opacity:   withTiming(isSelected.value, { duration: 150 }),
    transform: [{ scale: withSpring(isSelected.value, { damping: 14 }) }],
  }));

  return (
    <AnimatedPressable
      onPress={() => onToggle(brand.slug)}
      onPressIn={() => { pressed.value = 1; }}
      onPressOut={() => { pressed.value = 0; }}
      style={[
        {
          borderWidth:   1,
          borderRadius:  radius.lg,
          padding:       spacing.md,
          alignItems:    'center',
          gap:           spacing.sm,
          position:      'relative',
        },
        cardStyle,
      ]}
    >
      {/* Check badge */}
      <Animated.View
        style={[
          {
            position:        'absolute',
            top:             -5,
            right:           -5,
            width:           18,
            height:          18,
            borderRadius:    radius.pill,
            backgroundColor: colors.accent,
            alignItems:      'center',
            justifyContent:  'center',
            zIndex:          10,
          },
          checkStyle,
        ]}
      >
        {/* ✓ checkmark via SVG-like path via border trick */}
        <Text style={{ color: colors.bg, fontSize: 9, fontWeight: '800', lineHeight: 12 }}>✓</Text>
      </Animated.View>

      {/* Logo circle */}
      <Animated.View
        style={[
          {
            width:         48,
            height:        48,
            borderRadius:  radius.md,
            alignItems:    'center',
            justifyContent:'center',
            borderWidth:   1,
            borderColor:   selected ? brand.brandColor : colors.borderDim,
          },
          logoStyle,
        ]}
      >
        <Text
          style={{
            ...typography.monoLg,
            color:      selected ? '#FFFFFF' : brand.brandColor,
            lineHeight: 22,
          }}
        >
          {brand.initial}
        </Text>
      </Animated.View>

      {/* Name block */}
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text
          style={{
            ...typography.labelMd,
            color:     selected ? colors.textPrimary : colors.textSecondary,
            textAlign: 'center',
          }}
          numberOfLines={1}
        >
          {brand.nameEn}
        </Text>
        <Text
          style={{
            ...typography.monoXs,
            color:     colors.textTertiary,
            textAlign: 'center',
            writingDirection: 'rtl',
          }}
          numberOfLines={1}
        >
          {brand.nameHe}
        </Text>
      </View>
    </AnimatedPressable>
  );
}
