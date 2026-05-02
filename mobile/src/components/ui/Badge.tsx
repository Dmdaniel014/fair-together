// ─────────────────────────────────────────────────────────────────────────────
//  Badge.tsx — Fair Together · Design System primitive
//  Tiny status dot + label pill.
//  Ported from design-package Primitives.jsx → Badge.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Text, View } from 'react-native';
import { radius } from '@/theme';

interface BadgeProps {
  label: string;
  color?: string;        // dominant color
  tone?: 'success' | 'warning' | 'info' | 'neutral' | 'danger';
}

const TONE_MAP: Record<NonNullable<BadgeProps['tone']>, string> = {
  success: '#059669',
  warning: '#D97706',
  info:    '#2563EB',
  neutral: '#64748B',
  danger:  '#DC2626',
};

export function Badge({ label, color, tone = 'success' }: BadgeProps) {
  const c = color || TONE_MAP[tone];
  return (
    <View
      style={{
        flexDirection: 'row-reverse',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: withAlpha(c, 0x1f),
        borderWidth: 1,
        borderColor: withAlpha(c, 0x40),
        alignSelf: 'flex-start',
      }}
    >
      <View style={{ width: 5, height: 5, borderRadius: radius.pill, backgroundColor: c }} />
      <Text style={{
        color: c,
        fontSize: 11,
        fontWeight: '600',
        fontFamily: 'Heebo_600SemiBold',
      }}>
        {label}
      </Text>
    </View>
  );
}

// ── util: hex (#rrggbb or #rgb) → rgba(r,g,b, alpha/255)
function withAlpha(hex: string, alphaByte: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const a = (alphaByte & 0xff) / 255;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a.toFixed(3)})`;
}

function parseHex(h: string): { r: number; g: number; b: number } | null {
  let s = h.replace('#', '').trim();
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length !== 6) return null;
  const n = parseInt(s, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

// Re-export the palette in case callers want to match
export const BADGE_TONE_COLORS = TONE_MAP;
