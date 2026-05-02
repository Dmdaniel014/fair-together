// ─────────────────────────────────────────────────────────────
//  GlobalAlertBanner.tsx
//  "Global Watch" — international suits with IL potential
//  Left-border accent pattern from Figma direction
// ─────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { colors, typography, spacing, radius } from '../theme';

interface MatchResult {
  caseNumber:       string;
  caseTitleEn:      string;
  brandName:        string;
  potentialPayout?: string;
  summary?:         string;
  technicalSpecs?:  { globalNote?: string };
}

interface GlobalAlertBannerProps {
  match:   MatchResult;
  onPress: (match: MatchResult) => void;
}

export function GlobalAlertBanner({ match, onPress }: GlobalAlertBannerProps) {
  return (
    <Pressable
      onPress={() => onPress(match)}
      style={({ pressed }) => ({
        backgroundColor: pressed ? `${colors.info}08` : `${colors.info}05`,
        borderWidth:     1,
        borderColor:     `${colors.info}25`,
        borderLeftWidth: 3,
        borderLeftColor: colors.info,
        borderRadius:    radius.lg,
        padding:         spacing.base,
        gap:             spacing.sm,
      })}
    >
      {/* Header row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems:    'center',
          gap:           spacing.sm,
        }}
      >
        {/* Pulsing dot */}
        <View
          style={{
            width:           6,
            height:          6,
            borderRadius:    radius.pill,
            backgroundColor: colors.info,
          }}
        />
        <Text
          style={{
            ...typography.monoXs,
            color:         colors.info,
            fontWeight:    '700',
            letterSpacing: 1.2,
            flex:          1,
          }}
        >
          GLOBAL WATCH  ·  {match.caseNumber}
        </Text>
        <View
          style={{
            paddingVertical:   3,
            paddingHorizontal: 9,
            backgroundColor:   `${colors.info}12`,
            borderWidth:       1,
            borderColor:       `${colors.info}35`,
            borderRadius:      radius.pill,
          }}
        >
          <Text
            style={{ ...typography.monoXs, color: colors.info, fontWeight: '700' }}
          >
            MONITOR
          </Text>
        </View>
      </View>

      {/* Title — Inter 700 */}
      <Text
        style={{
          ...typography.bodyMd,
          fontWeight: '700',
          color:      colors.textPrimary,
        }}
      >
        {match.caseTitleEn}
      </Text>

      {/* Global note or truncated summary */}
      <Text
        style={{
          ...typography.bodySmall,
          color:      colors.textSecondary,
          lineHeight: 18,
        }}
        numberOfLines={2}
      >
        {match.technicalSpecs?.globalNote ?? match.summary}
      </Text>

      {/* Bottom row: payout + defendant */}
      <View
        style={{
          flexDirection:  'row',
          justifyContent: 'space-between',
          alignItems:     'center',
          paddingTop:     spacing.xs,
          borderTopWidth: 1,
          borderTopColor: `${colors.info}15`,
        }}
      >
        <Text style={{ ...typography.monoXs, color: colors.textTertiary }}>
          potential payout:{' '}
          <Text style={{ color: colors.info, fontWeight: '600' }}>
            {match.potentialPayout}
          </Text>
        </Text>
        <Text style={{ ...typography.monoXs, color: colors.textTertiary }}>
          {match.brandName}
        </Text>
      </View>
    </Pressable>
  );
}
