// ─────────────────────────────────────────────────────────────
//  LawsuitCard.tsx
//  Figma frame: "Lawsuit Card" — node pending MCP diff
//  Typography: Inter labels + Fira Code for all data values
//  NativeWind v4 + React Native
// ─────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, typography, spacing, radius, statusConfig } from '../theme';

interface MatchResult {
  status:               string;
  matchConfidenceScore: number;
  caseTitleEn:          string;
  brandName:            string;
  caseNumber:           string;
  potentialPayout?:     string;
  estimatedPoolILS?:    number;
  claimDeadline?:       string;
}

interface LawsuitCardProps {
  match:    MatchResult;
  onPress:  (match: MatchResult) => void;
  isJoined: boolean;
}

function ConfidenceBar({ score, color }: { score: number; color: string }) {
  const width = useSharedValue(0);

  React.useEffect(() => {
    width.value = withTiming(score, { duration: 700 });
  }, [score]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${width.value}%` as any,
  }));

  return (
    <View
      style={{
        height:        3,
        backgroundColor: colors.borderDim,
        borderRadius:  radius.pill,
        overflow:      'hidden',
      }}
    >
      <Animated.View
        style={[
          { height: '100%', borderRadius: radius.pill, backgroundColor: color },
          barStyle,
        ]}
      />
    </View>
  );
}

export function LawsuitCard({ match, onPress, isJoined }: LawsuitCardProps) {
  const pressed = useSharedValue(0);
  const cfg     = statusConfig[match.status as keyof typeof statusConfig] ?? statusConfig.FILED;

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(pressed.value ? 0.985 : 1, { damping: 20 }) }],
  }));

  const barColor =
    match.matchConfidenceScore >= 70 ? colors.accent :
    match.matchConfidenceScore >= 45 ? colors.warning :
    colors.info;

  return (
    <Animated.View style={cardStyle}>
      <Pressable
        onPress={() => onPress(match)}
        onPressIn={() => { pressed.value = 1; }}
        onPressOut={() => { pressed.value = 0; }}
        style={{
          backgroundColor: colors.bgCard,
          borderWidth:     1,
          borderColor:     isJoined ? `${colors.accent}60` : colors.borderDim,
          borderRadius:    radius.lg,
          overflow:        'hidden',
        }}
      >
        {/* Joined accent line */}
        {isJoined && (
          <View
            style={{
              height:          2,
              backgroundColor: colors.accent,
              width:           '100%',
            }}
          />
        )}

        <View style={{ padding: spacing.base }}>
          {/* Row 1: Title + status badge */}
          <View
            style={{
              flexDirection:  'row',
              justifyContent: 'space-between',
              alignItems:     'flex-start',
              gap:            spacing.sm,
              marginBottom:   spacing.sm,
            }}
          >
            <View style={{ flex: 1 }}>
              {/* Case title — Inter 700 */}
              <Text
                style={{
                  ...typography.bodyMd,
                  fontWeight:  '700',
                  color:       colors.textPrimary,
                  lineHeight:  20,
                  marginBottom: 3,
                }}
                numberOfLines={2}
              >
                {match.caseTitleEn}
              </Text>

              {/* Case number — Fira Code */}
              <Text style={{ ...typography.monoXs, color: colors.textTertiary }}>
                {match.brandName}  ·  {match.caseNumber}
              </Text>
            </View>

            {/* Status badge */}
            <View
              style={{
                flexDirection:   'row',
                alignItems:      'center',
                gap:             5,
                paddingVertical: 4,
                paddingHorizontal: 9,
                backgroundColor: cfg.bg,
                borderWidth:     1,
                borderColor:     `${cfg.color}40`,
                borderRadius:    radius.pill,
                flexShrink:      0,
              }}
            >
              <View
                style={{
                  width:           5,
                  height:          5,
                  borderRadius:    radius.pill,
                  backgroundColor: cfg.color,
                }}
              />
              <Text
                style={{
                  ...typography.labelXs,
                  color:    cfg.color,
                  fontSize: 9,
                }}
              >
                {cfg.label.toUpperCase()}
              </Text>
            </View>
          </View>

          {/* Row 2: Confidence bar */}
          <View style={{ marginBottom: spacing.sm }}>
            <View
              style={{
                flexDirection:  'row',
                justifyContent: 'space-between',
                marginBottom:   5,
              }}
            >
              <Text style={{ ...typography.monoXs, color: colors.textTertiary }}>
                match confidence
              </Text>
              {/* Score — Fira Code bold */}
              <Text
                style={{
                  ...typography.monoSm,
                  fontWeight: '600',
                  color:      barColor,
                }}
              >
                {match.matchConfidenceScore}%
              </Text>
            </View>
            <ConfidenceBar score={match.matchConfidenceScore} color={barColor} />
          </View>

          {/* Row 3: Data triplet — all Fira Code */}
          <View
            style={{
              flexDirection: 'row',
              gap:           spacing.xl,
              paddingTop:    spacing.sm,
              borderTopWidth: 1,
              borderTopColor: colors.borderDim,
            }}
          >
            <View style={{ gap: 3 }}>
              <Text style={{ ...typography.monoXs, color: colors.textTertiary }}>
                payout range
              </Text>
              <Text
                style={{ ...typography.monoMd, fontWeight: '600', color: colors.accent }}
              >
                {match.potentialPayout ?? '—'}
              </Text>
            </View>

            <View style={{ gap: 3 }}>
              <Text style={{ ...typography.monoXs, color: colors.textTertiary }}>
                claim pool
              </Text>
              <Text
                style={{ ...typography.monoMd, fontWeight: '600', color: colors.textPrimary }}
              >
                {match.estimatedPoolILS ? `₪${match.estimatedPoolILS}M` : 'TBD'}
              </Text>
            </View>

            {match.claimDeadline && (
              <View style={{ gap: 3, marginLeft: 'auto' }}>
                <Text style={{ ...typography.monoXs, color: colors.textTertiary }}>
                  deadline
                </Text>
                <Text
                  style={{ ...typography.monoSm, fontWeight: '600', color: colors.danger }}
                >
                  {match.claimDeadline}
                </Text>
              </View>
            )}
          </View>

          {/* Joined indicator */}
          {isJoined && (
            <View
              style={{
                marginTop:      spacing.sm,
                flexDirection:  'row',
                alignItems:     'center',
                gap:            5,
              }}
            >
              <View
                style={{
                  width:           6,
                  height:          6,
                  borderRadius:    radius.pill,
                  backgroundColor: colors.accent,
                }}
              />
              <Text
                style={{ ...typography.monoXs, color: colors.accent, fontWeight: '600' }}
              >
                claim registered — monitoring updates
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}
