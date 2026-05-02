// ─────────────────────────────────────────────────────────────────────────────
//  SelectionChip.tsx
//  Used for BOTH Category pills (step 1/3) and Brand chips (step 2/3)
//  Matches Figma exactly:
//    Unselected: white bg, 1px #E5E7EB border, radius 8, Heebo Medium 14
//    Selected:   #EEF3FD bg, 1.5px #2F6FED border, same size/font
//    No logo — text-only chips matching the Figma screenshots
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { colors, typography, radius, spacing } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface SelectionChipProps {
  label:    string;
  selected: boolean;
  onToggle: () => void;
}

export function SelectionChip({ label, selected, onToggle }: SelectionChipProps) {
  const prog = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    prog.value = withSpring(selected ? 1 : 0, {
      damping:   20,
      stiffness: 260,
      mass:      0.6,
    });
  }, [selected]);

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      prog.value,
      [0, 1],
      [colors.bgWhite, colors.bgBlue]
    ),
    borderColor: interpolateColor(
      prog.value,
      [0, 1],
      [colors.borderDefault, colors.borderFocus]
    ),
    borderWidth:    selected ? 1.5 : 1,
    transform: [{ scale: withSpring(selected ? 1.02 : 1, { damping: 18 }) }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      prog.value,
      [0, 1],
      [colors.textPrimary, colors.primary]
    ),
  }));

  return (
    <AnimatedPressable
      onPress={onToggle}
      style={[
        {
          paddingVertical:   10,
          paddingHorizontal: 16,
          borderRadius:      radius.md,
          alignItems:        'center',
          justifyContent:    'center',
        },
        containerStyle,
      ]}
    >
      <Animated.Text
        style={[
          {
            ...typography.chip,
            textAlign: 'center',
          },
          textStyle,
        ]}
      >
        {label}
      </Animated.Text>
    </AnimatedPressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  TimeWindowRow.tsx
//  Step 3/3 — radio list rows
//  Figma: white card, 1px border, radio circle right-aligned (RTL)
//  Selected: #EEF3FD bg, filled blue radio dot, blue border
// ─────────────────────────────────────────────────────────────────────────────
interface TimeWindowRowProps {
  label:    string;
  selected: boolean;
  onSelect: () => void;
}

export function TimeWindowRow({ label, selected, onSelect }: TimeWindowRowProps) {
  const prog = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    prog.value = withTiming(selected ? 1 : 0, { duration: 180 });
  }, [selected]);

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      prog.value,
      [0, 1],
      [colors.bgWhite, colors.bgBlue]
    ),
    borderColor: interpolateColor(
      prog.value,
      [0, 1],
      [colors.borderDefault, colors.borderFocus]
    ),
  }));

  const radioBorderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      prog.value,
      [0, 1],
      [colors.borderDefault, colors.primary]
    ),
  }));

  const radioDotStyle = useAnimatedStyle(() => ({
    opacity:   withTiming(prog.value, { duration: 150 }),
    transform: [{ scale: withSpring(prog.value, { damping: 16 }) }],
  }));

  return (
    <AnimatedPressable
      onPress={onSelect}
      style={[
        {
          flexDirection:     'row-reverse', // RTL: label right, radio left in visual
          alignItems:        'center',
          justifyContent:    'space-between',
          paddingVertical:   16,
          paddingHorizontal: spacing.base,
          borderWidth:       1,
          borderRadius:      radius.lg,
          marginBottom:      spacing.sm,
        },
        containerStyle,
      ]}
    >
      {/* Label — right side in RTL */}
      <Text
        style={{
          ...typography.labelMd,
          color: selected ? colors.primary : colors.textPrimary,
        }}
      >
        {label}
      </Text>

      {/* Radio circle — left side in RTL */}
      <Animated.View
        style={[
          {
            width:          22,
            height:         22,
            borderRadius:   11,
            borderWidth:    2,
            alignItems:     'center',
            justifyContent: 'center',
          },
          radioBorderStyle,
        ]}
      >
        <Animated.View
          style={[
            {
              width:           12,
              height:          12,
              borderRadius:    6,
              backgroundColor: colors.primary,
            },
            radioDotStyle,
          ]}
        />
      </Animated.View>
    </AnimatedPressable>
  );
}
