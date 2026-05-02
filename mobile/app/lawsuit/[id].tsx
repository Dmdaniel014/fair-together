// ─────────────────────────────────────────────────────────────────────────────
//  app/lawsuit/[id].tsx — Lawsuit detail + claim actions
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, SafeAreaView, StatusBar,
  TextInput,
} from 'react-native';
import Animated, { FadeInDown, FadeIn, useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useLocalSearchParams, router } from 'expo-router';
import { colors, typography, spacing, radius, shadows, glass, formatDate, formatCurrency, formatRelativeDate, isStaleLawsuit } from '@/theme';
import BrandLogo from '@/components/BrandLogo';
import GlassCard from '@/components/GlassCard';
import * as api from '@/services/api';
import type { Lawsuit, LawsuitStatus, EligibilityResult } from '@/services/api';

// Detail screen uses longer, more descriptive status labels
const STATUS_LABELS: Record<LawsuitStatus, { label: string; color: string; bg: string; icon: string }> = {
  SETTLEMENT_APPROVED: { label: 'פשרה אושרה — ניתן לתבוע פיצוי!',  color: '#16A34A', bg: '#DCFCE7', icon: '✅' },
  SETTLEMENT:          { label: 'בהליך פשרה',                       color: '#D97706', bg: '#FEF3C7', icon: '⏳' },
  RULING:              { label: 'בית המשפט קיבל את התביעה',          color: '#2563EB', bg: '#DBEAFE', icon: '⚖️' },
  CERTIFIED:           { label: 'אושרה כתביעה ייצוגית',             color: '#7C3AED', bg: '#EDE9FE', icon: '📋' },
  FILED:               { label: 'הוגשה לבית המשפט',                 color: '#6B7280', bg: '#F3F4F6', icon: '📄' },
  DISCOVERY:           { label: 'שלב גילוי מסמכים',                 color: '#6B7280', bg: '#F3F4F6', icon: '🔍' },
  CLOSED:              { label: 'התיק נסגר',                        color: '#9CA3AF', bg: '#F9FAFB', icon: '🔒' },
  DISMISSED:           { label: 'התביעה נדחתה',                      color: '#9CA3AF', bg: '#F9FAFB', icon: '❌' },
};

function daysUntil(iso: string): number {
  const deadline = new Date(iso);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);
  return Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function ActionButton({ label, color, bg, onPress, primary }: {
  label: string; color: string; bg: string; onPress: () => void; primary?: boolean;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(scale.value, { damping: 20 }) }],
  }));
  return (
    <Animated.View style={[style, { flex: 1 }]}>
      <Pressable
        onPressIn={() => { scale.value = 0.95; }}
        onPressOut={() => { scale.value = 1; }}
        onPress={onPress}
        style={{
          height: primary ? 52 : 44, borderRadius: radius.lg,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: primary ? color : bg,
          borderWidth: primary ? 0 : 1, borderColor: `${color}40`,
        }}
      >
        <Text style={{
          ...typography.labelMd, fontWeight: '700',
          color: primary ? '#FFFFFF' : color,
        }}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export default function LawsuitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [lawsuit, setLawsuit] = useState<Lawsuit | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimAction, setClaimAction] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // AI Summary streaming
  const [summaryText, setSummaryText] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryDone, setSummaryDone] = useState(false);
  const [summaryError, setSummaryError] = useState(false);

  // AI Eligibility
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);

  // Follow-up questions flow
  const [followUpAnswer, setFollowUpAnswer] = useState('');
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false);

  useEffect(() => {
    // Both calls are independent — getUserClaims is non-critical (already
    // catches its own errors). getLawsuitById may legitimately 404 if this
    // screen was opened from a stale push notification or deep-link; in that
    // case we just leave `lawsuit` null and the UI shows "תביעה לא נמצאה".
    Promise.all([
      api.getLawsuitById(id).catch(() => null),
      api.getUserClaims().catch(() => ({ claims: [] })),
    ]).then(([l, c]) => {
      setLawsuit(l);
      const existing = c.claims.find(cl => cl.lawsuitId === id);
      if (existing) setClaimAction(existing.action);
    }).finally(() => setLoading(false));
  }, [id]);

  // Auto-load AI summary when lawsuit loads
  useEffect(() => {
    if (!lawsuit) return;
    setSummaryLoading(true);
    api.streamLawsuitSummary(
      id,
      (chunk) => setSummaryText(prev => prev + chunk),
      () => { setSummaryLoading(false); setSummaryDone(true); },
      () => { setSummaryLoading(false); setSummaryError(true); },
    );
  }, [lawsuit?.id]);

  const handleEligibilityCheck = useCallback(async () => {
    setEligibilityLoading(true);
    try {
      const result = await api.checkEligibility(id);
      setEligibility(result);
    } catch {
      setEligibility({ eligible: 'MAYBE', confidence: 0, explanation: 'לא הצלחנו לבדוק כרגע. נסו שוב מאוחר יותר.' });
    } finally {
      setEligibilityLoading(false);
    }
  }, [id]);

  const handleFollowUpSubmit = useCallback(async (directAnswer?: string) => {
    const answer = (directAnswer ?? followUpAnswer).trim();
    if (!answer || !eligibility?.followUp) return;
    setFollowUpSubmitting(true);
    try {
      const result = await api.submitFollowUpAnswers(id, [
        { question: eligibility.followUp, answer },
      ]);
      setEligibility(result);
      setFollowUpAnswer('');
    } catch {
      // keep existing result
    } finally {
      setFollowUpSubmitting(false);
    }
  }, [id, followUpAnswer, eligibility?.followUp]);

  const deadlineInfo = useMemo(() => {
    if (!lawsuit?.claimDeadline) return null;
    const days = daysUntil(lawsuit.claimDeadline);
    if (days < 0) return { days, label: 'המועד האחרון עבר', color: colors.textDisabled, bg: '#F9FAFB', urgent: false };
    if (days === 0) return { days, label: 'היום הוא המועד האחרון!', color: '#DC2626', bg: '#FEE2E2', urgent: true };
    if (days <= 7) return { days, label: `נותרו ${days} ימים`, color: '#DC2626', bg: '#FEE2E2', urgent: true };
    if (days <= 30) return { days, label: `נותרו ${days} ימים`, color: '#D97706', bg: '#FEF3C7', urgent: false };
    return { days, label: `נותרו ${days} ימים`, color: '#16A34A', bg: '#DCFCE7', urgent: false };
  }, [lawsuit?.claimDeadline]);

  async function handleClaim(action: 'JOINED' | 'SAVED' | 'DISMISSED') {
    setSubmitting(true);
    try {
      await api.submitClaim(id, action);
      setClaimAction(action);
    } catch {
      setClaimAction(action);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgPage, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!lawsuit) {
    return (
      <SafeAreaView style={{
        flex: 1, backgroundColor: colors.bgPage,
        justifyContent: 'center', alignItems: 'center',
        padding: spacing.xl, gap: spacing.base,
      }}>
        <Text style={{ fontSize: 44 }}>🔍</Text>
        <Text style={{ ...typography.h2, color: colors.textPrimary, textAlign: 'center' }}>
          התביעה לא נמצאה
        </Text>
        <Text style={{ ...typography.bodyBase, color: colors.textTertiary, textAlign: 'center' }}>
          ייתכן שהקישור ישן או שהתביעה הוסרה מהמאגר.
        </Text>
        <Pressable
          onPress={() => router.replace('/(tabs)')}
          style={{
            marginTop: spacing.md,
            paddingHorizontal: spacing.xl, height: 44,
            borderRadius: 12,
            backgroundColor: colors.primary,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ ...typography.button, color: '#FFFFFF' }}>חזרה לבית</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const statusCfg = STATUS_LABELS[lawsuit.status] ?? STATUS_LABELS.FILED;
  const isActionable = ['SETTLEMENT', 'SETTLEMENT_APPROVED', 'RULING', 'CERTIFIED'].includes(lawsuit.status);
  const isSettlement = lawsuit.status === 'SETTLEMENT_APPROVED' || lawsuit.status === 'SETTLEMENT';
  const stale = isStaleLawsuit(lawsuit.filingDate, lawsuit.lastUpdatedAt);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <StatusBar barStyle="dark-content" />

      {/* Back button — glass pill */}
      <Pressable
        onPress={() => router.back()}
        style={{
          paddingHorizontal: spacing.base, paddingVertical: spacing.md,
          flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        }}
      >
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
          paddingHorizontal: spacing.md, paddingVertical: 6,
          backgroundColor: colors.glass, borderRadius: radius.pill,
          borderWidth: 1, borderColor: colors.glassBorder,
          ...shadows.glass,
        }}>
          <Text style={{ fontSize: 16, color: colors.primary }}>→</Text>
          <Text style={{ ...typography.labelMd, color: colors.primary }}>חזרה</Text>
        </View>
      </Pressable>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }} showsVerticalScrollIndicator={false}>
        {/* Status banner */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <View style={{
            marginHorizontal: spacing.base, marginBottom: spacing.base,
            padding: spacing.base, backgroundColor: statusCfg.bg,
            borderRadius: radius.lg, borderWidth: 1, borderColor: `${statusCfg.color}30`,
            flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm,
          }}>
            <Text style={{ fontSize: 20 }}>{statusCfg.icon}</Text>
            <Text style={{ ...typography.labelLg, color: statusCfg.color, textAlign: 'right', fontWeight: '700', flex: 1 }}>
              {statusCfg.label}
            </Text>
          </View>
        </Animated.View>

        {/* Deadline countdown — prominent when urgent */}
        {deadlineInfo && (
          <Animated.View entering={FadeInDown.delay(50).duration(300)}>
            <View style={{
              marginHorizontal: spacing.base, marginBottom: spacing.base,
              padding: spacing.base, backgroundColor: deadlineInfo.bg,
              borderRadius: radius.lg, borderWidth: 1, borderColor: `${deadlineInfo.color}30`,
              flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm }}>
                <Text style={{ fontSize: 20 }}>{deadlineInfo.urgent ? '🔥' : '📅'}</Text>
                <View>
                  <Text style={{ ...typography.labelSm, color: deadlineInfo.color, textAlign: 'right' }}>מועד אחרון להגשה</Text>
                  <Text style={{ ...typography.labelLg, color: deadlineInfo.color, textAlign: 'right', fontWeight: '700' }}>
                    {deadlineInfo.label}
                  </Text>
                </View>
              </View>
              <Text style={{ ...typography.bodySm, color: deadlineInfo.color }}>
                {formatDate(lawsuit.claimDeadline)}
              </Text>
            </View>
          </Animated.View>
        )}

        {/* Stale warning */}
        {stale && (
          <Animated.View entering={FadeInDown.delay(75).duration(300)}>
            <View style={{
              marginHorizontal: spacing.base, marginBottom: spacing.base,
              padding: spacing.md, backgroundColor: '#FFFBEB',
              borderRadius: radius.lg, borderWidth: 1, borderColor: '#FCD34D50',
              flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm,
            }}>
              <Text style={{ fontSize: 18 }}>⏸</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.labelMd, color: '#92400E', textAlign: 'right', fontWeight: '700' }}>
                  ייתכן שהתיק לא פעיל
                </Text>
                <Text style={{ ...typography.bodySm, color: '#92400E', textAlign: 'right', marginTop: 2 }}>
                  עדכון אחרון: {formatRelativeDate(lawsuit.lastUpdatedAt)}
                </Text>
              </View>
            </View>
          </Animated.View>
        )}

        {/* Main card — Glass */}
        <Animated.View entering={FadeInDown.delay(100).duration(300)}>
          <View style={{ marginHorizontal: spacing.base }}>
          <GlassCard
            variant={isSettlement ? 'accent' : 'default'}
            accentColor={isSettlement ? statusCfg.color : stale ? '#FCD34D' : undefined}
          >
            <View style={{ gap: spacing.base }}>
              {/* Defendant — logo + name */}
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.base }}>
                <BrandLogo slug={lawsuit.defendantSlug} name={lawsuit.defendantName} size={52} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...typography.h1, color: colors.textPrimary, textAlign: 'right' }}>
                    {lawsuit.defendantName}
                  </Text>
                  <Text style={{ ...typography.bodySm, color: colors.textTertiary, textAlign: 'right', marginTop: 4 }}>
                    מס׳ תיק: {lawsuit.caseNumber}
                  </Text>
                </View>
              </View>

              {/* Summary */}
              {lawsuit.summary && (
                <View>
                  <Text style={{ ...typography.labelMd, color: colors.textPrimary, textAlign: 'right', marginBottom: 4 }}>
                    תקציר
                  </Text>
                  <Text style={{ ...typography.bodyBase, color: colors.textSecondary, textAlign: 'right', lineHeight: 22 }}>
                    {lawsuit.summary}
                  </Text>
                </View>
              )}

              {/* Details grid */}
              <View style={{ gap: spacing.md }}>
                <DetailRow label="בית משפט" value={lawsuit.court ?? '—'} />
                <DetailRow label="תאריך הגשה" value={formatDate(lawsuit.filingDate)} />
                {lawsuit.lastUpdatedAt && (
                  <DetailRow
                    label="עדכון אחרון"
                    value={formatRelativeDate(lawsuit.lastUpdatedAt)}
                    valueColor={stale ? '#92400E' : undefined}
                  />
                )}
                {lawsuit.closeDate && <DetailRow label="תאריך סגירה" value={formatDate(lawsuit.closeDate)} />}
                {lawsuit.result && <DetailRow label="תוצאה" value={lawsuit.result} />}
                <DetailRow label="תובע" value={lawsuit.plaintiffName ?? '—'} />
                {lawsuit.lawyers && <DetailRow label="עורכי דין" value={lawsuit.lawyers} />}
              </View>
            </View>
          </GlassCard>
          </View>
        </Animated.View>

        {/* AI Summary — streaming — Glass */}
        <Animated.View entering={FadeInDown.delay(125).duration(300)}>
          <View style={{ marginHorizontal: spacing.base, marginTop: spacing.base }}>
          <GlassCard variant="accent" accentColor={colors.primary}>
            <View style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm }}>
                <Text style={{ fontSize: 18 }}>🤖</Text>
                <Text style={{ ...typography.h2, color: colors.textPrimary, textAlign: 'right', flex: 1 }}>
                  סיכום AI
                </Text>
                {summaryLoading && <ActivityIndicator size="small" color={colors.primary} />}
              </View>

              {summaryText ? (
                <Animated.View entering={FadeIn.duration(200)}>
                  <Text style={{
                    ...typography.bodyBase, color: colors.textSecondary,
                    textAlign: 'right', lineHeight: 24,
                  }}>
                    {summaryText}{summaryLoading ? '▊' : ''}
                  </Text>
                </Animated.View>
              ) : summaryError ? (
                <Text style={{ ...typography.bodySm, color: colors.textTertiary, textAlign: 'right' }}>
                  לא ניתן לטעון סיכום כרגע
                </Text>
              ) : (
                <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={{ ...typography.bodySm, color: colors.textTertiary, marginTop: spacing.sm }}>
                    מכין סיכום...
                  </Text>
                </View>
              )}
            </View>
          </GlassCard>
          </View>
        </Animated.View>

        {/* AI Eligibility Check — Glass */}
        <Animated.View entering={FadeInDown.delay(135).duration(300)}>
          <View style={{ marginHorizontal: spacing.base, marginTop: spacing.base }}>
          <GlassCard>
            <View style={{ gap: spacing.md }}>
              {!eligibility ? (
                <Pressable
                  onPress={handleEligibilityCheck}
                  disabled={eligibilityLoading}
                  style={{
                    padding: spacing.base, backgroundColor: '#EEF3FD',
                    borderRadius: radius.md, alignItems: 'center', gap: spacing.sm,
                    flexDirection: 'row-reverse', justifyContent: 'center',
                  }}
                >
                  {eligibilityLoading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={{ fontSize: 20 }}>🔍</Text>
                  )}
                  <Text style={{ ...typography.labelLg, color: colors.primary, fontWeight: '700' }}>
                    {eligibilityLoading ? 'בודק...' : 'האם אני זכאי?'}
                  </Text>
                </Pressable>
              ) : (
                <Animated.View entering={FadeIn.duration(300)}>
                  <View style={{
                    padding: spacing.base, borderRadius: radius.md,
                    backgroundColor: eligibility.eligible === 'YES' ? '#F0FDF4'
                      : eligibility.eligible === 'NO' ? '#FEF2F2' : '#FFFBEB',
                    borderWidth: 1,
                    borderColor: eligibility.eligible === 'YES' ? '#16A34A30'
                      : eligibility.eligible === 'NO' ? '#DC262630' : '#D9770630',
                    gap: spacing.sm,
                  }}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm }}>
                      <Text style={{ fontSize: 22 }}>
                        {eligibility.eligible === 'YES' ? '✅' : eligibility.eligible === 'NO' ? '❌' : '🤔'}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{
                          ...typography.labelLg, textAlign: 'right', fontWeight: '700',
                          color: eligibility.eligible === 'YES' ? '#16A34A'
                            : eligibility.eligible === 'NO' ? '#DC2626' : '#D97706',
                        }}>
                          {eligibility.eligible === 'YES' ? 'סביר שאתה זכאי!'
                            : eligibility.eligible === 'NO' ? 'כנראה שלא' : 'ייתכן — צריך לבדוק'}
                        </Text>
                        {eligibility.confidence > 0 && (
                          <Text style={{ ...typography.bodySm, color: colors.textTertiary, textAlign: 'right' }}>
                            רמת ביטחון: {eligibility.confidence}%
                          </Text>
                        )}
                      </View>
                    </View>
                    <Text style={{ ...typography.bodyBase, color: colors.textSecondary, textAlign: 'right', lineHeight: 22 }}>
                      {eligibility.explanation}
                    </Text>
                    {eligibility.followUp && eligibility.eligible === 'MAYBE' && (
                      <View style={{
                        marginTop: spacing.sm, padding: spacing.md,
                        backgroundColor: '#FEF3C7', borderRadius: radius.md,
                        gap: spacing.sm,
                      }}>
                        <Text style={{ ...typography.labelMd, color: '#92400E', textAlign: 'right', fontWeight: '600' }}>
                          💡 {eligibility.followUp}
                        </Text>
                        <View style={{ flexDirection: 'row-reverse', gap: spacing.sm, alignItems: 'center' }}>
                          <TextInput
                            value={followUpAnswer}
                            onChangeText={setFollowUpAnswer}
                            placeholder="הקלד תשובה..."
                            placeholderTextColor={colors.textDisabled}
                            multiline
                            style={{
                              flex: 1, minHeight: 40, maxHeight: 80,
                              backgroundColor: '#FFFFFF', borderRadius: radius.sm,
                              paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
                              ...typography.bodyBase, color: colors.textPrimary, textAlign: 'right',
                              borderWidth: 1, borderColor: '#D9770640',
                            }}
                          />
                        </View>
                        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                          <Pressable
                            onPress={() => handleFollowUpSubmit()}
                            disabled={!followUpAnswer.trim() || followUpSubmitting}
                            style={{
                              flex: 1, paddingVertical: spacing.sm,
                              backgroundColor: followUpAnswer.trim() ? '#D97706' : '#D9770640',
                              borderRadius: radius.sm, alignItems: 'center',
                              flexDirection: 'row-reverse', justifyContent: 'center', gap: spacing.xs,
                            }}
                          >
                            {followUpSubmitting ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                              <Text style={{ ...typography.labelMd, color: '#FFFFFF', fontWeight: '700' }}>
                                בדוק שוב
                              </Text>
                            )}
                          </Pressable>
                          <Pressable
                            onPress={() => handleFollowUpSubmit('כן')}
                            disabled={followUpSubmitting}
                            style={{
                              paddingVertical: spacing.sm, paddingHorizontal: spacing.base,
                              backgroundColor: '#16A34A20', borderRadius: radius.sm, alignItems: 'center',
                            }}
                          >
                            <Text style={{ ...typography.labelMd, color: '#16A34A', fontWeight: '600' }}>כן</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => handleFollowUpSubmit('לא')}
                            disabled={followUpSubmitting}
                            style={{
                              paddingVertical: spacing.sm, paddingHorizontal: spacing.base,
                              backgroundColor: '#DC262620', borderRadius: radius.sm, alignItems: 'center',
                            }}
                          >
                            <Text style={{ ...typography.labelMd, color: '#DC2626', fontWeight: '600' }}>לא</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </View>
                </Animated.View>
              )}
            </View>
          </GlassCard>
          </View>
        </Animated.View>

        {/* Payout section — Glass */}
        {(lawsuit.totalPoolILS || lawsuit.payoutMinILS) && (
          <Animated.View entering={FadeInDown.delay(150).duration(300)}>
            <View style={{ marginHorizontal: spacing.base, marginTop: spacing.base }}>
            <GlassCard>
              <View style={{ gap: spacing.md }}>
                <Text style={{ ...typography.h2, color: colors.textPrimary, textAlign: 'right' }}>
                  פרטי פיצוי
                </Text>

                {/* Payout range highlight */}
                {lawsuit.payoutMinILS && lawsuit.payoutMaxILS && (
                  <View style={{
                    padding: spacing.base, backgroundColor: '#F0FDF4',
                    borderRadius: radius.md, borderWidth: 1, borderColor: '#16A34A20',
                    alignItems: 'center',
                  }}>
                    <Text style={{ ...typography.caption, color: colors.textTertiary, marginBottom: 4 }}>פיצוי צפוי לאדם</Text>
                    <Text style={{ ...typography.displayMd, color: '#16A34A', fontWeight: '700' }}>
                      ₪{lawsuit.payoutMinILS} – ₪{lawsuit.payoutMaxILS}
                    </Text>
                  </View>
                )}

                {lawsuit.totalPoolILS && (
                  <DetailRow label="סכום תביעה כולל" value={formatCurrency(lawsuit.totalPoolILS)} />
                )}
                {lawsuit.classSizeEstimate && (
                  <DetailRow label="מספר נפגעים משוער" value={lawsuit.classSizeEstimate.toLocaleString()} />
                )}
              </View>
            </GlassCard>
            </View>
          </Animated.View>
        )}

        {/* Eligibility section — Glass */}
        {lawsuit.eligibilityCriteria && (
          <Animated.View entering={FadeInDown.delay(200).duration(300)}>
            <View style={{ marginHorizontal: spacing.base, marginTop: spacing.base }}>
            <GlassCard>
              <View style={{ gap: spacing.sm }}>
                <Text style={{ ...typography.h2, color: colors.textPrimary, textAlign: 'right' }}>
                  מי זכאי?
                </Text>
                <View style={{
                  padding: spacing.md, backgroundColor: colors.bgBlue,
                  borderRadius: radius.md,
                }}>
                  <Text style={{ ...typography.bodyBase, color: colors.textPrimary, textAlign: 'right', lineHeight: 22 }}>
                    {lawsuit.eligibilityCriteria}
                  </Text>
                </View>
              </View>
            </GlassCard>
            </View>
          </Animated.View>
        )}

        {/* How to claim — Glass */}
        {isSettlement && (
          <Animated.View entering={FadeInDown.delay(250).duration(300)}>
            <View style={{ marginHorizontal: spacing.base, marginTop: spacing.base }}>
            <GlassCard variant="accent" accentColor="#059669">
              <View style={{ gap: spacing.md }}>
                <Text style={{ ...typography.h2, color: colors.textPrimary, textAlign: 'right' }}>
                  איך מגישים תביעה?
                </Text>
                <ClaimStep number={1} text='לחצו על "הצטרפות לתביעה" למטה כדי לשמור את התביעה' />
                <ClaimStep number={2} text="בדקו אם אתם עומדים בתנאי הזכאות שמפורטים למעלה" />
                <ClaimStep number={3} text="הכינו מסמכים רלוונטיים (קבלות, חשבוניות, אישורים)" />
                <ClaimStep number={4} text="עקבו אחרי עדכונים — נשלח לכם התראה כשתפתח אפשרות להגשה" />
              </View>
            </GlassCard>
            </View>
          </Animated.View>
        )}

        {/* Action buttons */}
        <Animated.View entering={FadeInDown.delay(300).duration(300)}>
          <View style={{ paddingHorizontal: spacing.base, paddingTop: spacing.xl }}>
            {claimAction === 'JOINED' ? (
              <View style={{
                padding: spacing.base, backgroundColor: '#DCFCE7',
                borderRadius: radius.lg, alignItems: 'center', gap: spacing.xs,
              }}>
                <Text style={{ fontSize: 24 }}>✅</Text>
                <Text style={{ ...typography.labelLg, color: '#16A34A', fontWeight: '700' }}>
                  הצטרפת לתביעה זו
                </Text>
                <Text style={{ ...typography.bodySm, color: '#16A34A' }}>
                  נעדכן אותך כשיהיו חדשות
                </Text>
              </View>
            ) : claimAction === 'SAVED' ? (
              <View style={{ gap: spacing.sm }}>
                <View style={{
                  padding: spacing.md, backgroundColor: colors.bgBlue,
                  borderRadius: radius.lg, alignItems: 'center',
                }}>
                  <Text style={{ ...typography.labelMd, color: colors.primary, fontWeight: '600' }}>
                    התביעה שמורה ברשימה שלך
                  </Text>
                </View>
                {isActionable && (
                  <ActionButton
                    label="הצטרפות לתביעה"
                    color="#059669"
                    bg="#DCFCE7"
                    onPress={() => handleClaim('JOINED')}
                    primary
                  />
                )}
              </View>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {isActionable && (
                  <ActionButton
                    label="הצטרפות לתביעה"
                    color="#059669"
                    bg="#DCFCE7"
                    onPress={() => handleClaim('JOINED')}
                    primary
                  />
                )}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <ActionButton
                    label="שמירה"
                    color={colors.primary}
                    bg={colors.bgBlue}
                    onPress={() => handleClaim('SAVED')}
                  />
                  <ActionButton
                    label="לא רלוונטי"
                    color={colors.textTertiary}
                    bg={colors.bgPage}
                    onPress={() => handleClaim('DISMISSED')}
                  />
                </View>
              </View>
            )}
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function DetailRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <Text style={{ ...typography.bodyBase, color: valueColor ?? colors.textPrimary, textAlign: 'left', flex: 1 }}>{value}</Text>
      <Text style={{ ...typography.labelSm, color: colors.textTertiary, textAlign: 'right', marginLeft: spacing.base }}>{label}</Text>
    </View>
  );
}

function ClaimStep({ number, text }: { number: number; text: string }) {
  return (
    <View style={{ flexDirection: 'row-reverse', gap: spacing.sm, alignItems: 'flex-start' }}>
      <View style={{
        width: 24, height: 24, borderRadius: 12,
        backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ ...typography.labelSm, color: '#FFFFFF', fontWeight: '700' }}>{number}</Text>
      </View>
      <Text style={{ ...typography.bodyBase, color: colors.textSecondary, textAlign: 'right', flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
