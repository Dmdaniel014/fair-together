// ─────────────────────────────────────────────────────────────────────────────
//  app/settlement/[id].tsx — Settlement detail screen
//  Matches design-package → Screens.jsx → SettlementDetail:
//  · White header bar with back chevron + "פרטי פשרה"
//  · Info Card (logo + title + case#, payout / deadline 2-col)
//  · Green-accent Card for "יש למלא טופס תביעה" with confidence meter
//  · EligibilityPanel (AI engine) kept for smart classification
//  · Button primitives for all CTAs
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator,
  Linking, StatusBar, Platform,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useLocalSearchParams, router } from 'expo-router';
import {
  colors, typography, spacing, radius, shadows,
  formatDate, brandColor, BRAND_COLORS,
} from '@/theme';
import { Card, Button, Badge } from '@/components/ui';
import EligibilityPanel from '@/components/EligibilityPanel';
import * as api from '@/services/api';
import type { Settlement, SettlementCategory } from '@/services/api';

const CATEGORY_INFO = api.CATEGORY_INFO;

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysUntil(d: string | null) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
}

function methodLabel(m: string | null) {
  const map: Record<string, string> = {
    bank_transfer: 'העברה בנקאית',
    credit: 'זיכוי',
    check: "צ'ק",
    automatic: 'אוטומטי',
    voucher: 'שובר',
  };
  return m ? (map[m] ?? m) : null;
}

function statusCfg(s: string | null) {
  if (s === 'open')         return { label: 'פתוח להגשה',   color: '#059669' };
  if (s === 'distributing') return { label: 'בתהליך חלוקה', color: '#2563EB' };
  if (s === 'closed')       return { label: 'סגור',          color: '#94A3B8' };
  return                           { label: 'פעיל',          color: '#D97706' };
}

// ── Section header with icon ──────────────────────────────────────────────────
function SectionTitle({ icon, title, color = colors.textPrimary }: {
  icon: string; title: string; color?: string;
}) {
  return (
    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
      <Text style={{ fontSize: 18 }}>{icon}</Text>
      <Text style={{ ...typography.h3, color }}>{title}</Text>
    </View>
  );
}

// ── Numbered step — RTL: number on right, text on left ───────────────────────
function StepItem({ text, num, total }: { text: string; num: number; total: number }) {
  return (
    <View style={{
      flexDirection: 'row-reverse',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: num < total ? 1 : 0,
      borderBottomColor: colors.borderLight,
    }}>
      <View style={{
        width: 26, height: 26, borderRadius: 13,
        backgroundColor: colors.primary,
        alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, marginTop: 1,
      }}>
        <Text style={{ ...typography.caption, color: '#FFF', fontWeight: '800' }}>{num}</Text>
      </View>
      <Text style={{
        ...typography.bodyBase, color: colors.textSecondary,
        textAlign: 'right', lineHeight: 22, flex: 1,
      }}>{text}</Text>
    </View>
  );
}

// ── Confidence meter (design spec uses 87% as example) ───────────────────────
function ConfidenceMeter({ percent, color = colors.success }: { percent: number; color?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm,
      marginBottom: spacing.sm,
    }}>
      <Text style={{
        fontSize: 11, color: colors.textTertiary,
        minWidth: 60, textAlign: 'left',
      }}>
        {Math.round(clamped)}% ודאות
      </Text>
      <View style={{
        flex: 1, height: 4, borderRadius: radius.pill,
        backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden',
      }}>
        <View style={{
          width: `${clamped}%`, height: '100%',
          backgroundColor: color, borderRadius: radius.pill,
        }} />
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function SettlementDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setSettlement(await api.getSettlementById(id));
      } catch {
        try {
          const d = await api.getLawsuitById(id);
          setSettlement({ ...d, category: null, claimFormUrl: null, payoutMethod: null,
            distributionStatus: null, claimGuideSteps: null, claimGuideHe: null,
            estimatedPayout: null, isSettlement: true } as Settlement);
        } catch {
          setError('לא ניתן לטעון את ההסדר');
        }
      } finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );

  if (error || !settlement) return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl }}>
      <Text style={{ fontSize: 48, marginBottom: spacing.base }}>😕</Text>
      <Text style={{ ...typography.h2, color: colors.danger, textAlign: 'center' }}>
        {error ?? 'הסדר לא נמצא'}
      </Text>
      <View style={{ marginTop: spacing.lg }}>
        <Button label="חזרה" variant="ghost" size="md" onPress={() => router.back()} />
      </View>
    </View>
  );

  const catInfo = settlement.category ? CATEGORY_INFO[settlement.category as SettlementCategory] : null;
  const days    = daysUntil(settlement.claimDeadline);
  const urgent  = days !== null && days >= 0 && days <= 14;

  const payoutText = settlement.estimatedPayout
    ?? (settlement.payoutMinILS && settlement.payoutMaxILS
        ? `₪${settlement.payoutMinILS}–${settlement.payoutMaxILS}`
        : null);

  const steps: string[] = Array.isArray(settlement.claimGuideSteps)
    ? settlement.claimGuideSteps as string[]
    : [];

  const status = statusCfg(settlement.distributionStatus);
  const method = methodLabel(settlement.payoutMethod);

  // Brand color for logo tile
  const matchedBrand = Object.keys(BRAND_COLORS).find(b => settlement.defendantName.includes(b));
  const logoColor = matchedBrand ? BRAND_COLORS[matchedBrand] : brandColor(settlement.defendantName);

  // Confidence: derive from settlement.confidence string, or default 87 (matches design spec)
  const conf = typeof settlement.confidence === 'string'
    ? parseFloat(settlement.confidence)
    : NaN;
  const confidencePercent = Number.isFinite(conf)
    ? (conf <= 1 ? conf * 100 : conf)
    : 87;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <StatusBar barStyle="dark-content" />

      {/* ══ HEADER ══ */}
      <View style={{
        backgroundColor: colors.bgWhite,
        paddingTop: Platform.OS === 'ios' ? 54 : 32,
        paddingBottom: spacing.md,
        paddingHorizontal: spacing.lg,
        flexDirection: 'row-reverse',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderLight,
      }}>
        <Text style={{
          ...typography.h2, color: colors.textPrimary,
          flex: 1, textAlign: 'right',
        }}>
          פרטי פשרה
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ fontSize: 22, color: colors.textPrimary }}>›</Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.base, paddingBottom: 140, gap: spacing.md }}
      >
        {/* ══ INFO CARD — logo + title + case#, payout / deadline 2-col ══ */}
        <Animated.View entering={FadeInDown.delay(40).duration(240)}>
          <Card>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md }}>
              <View style={{
                width: 48, height: 48, borderRadius: 14,
                backgroundColor: logoColor,
                alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {catInfo ? (
                  <Text style={{ fontSize: 22 }}>{catInfo.icon}</Text>
                ) : (
                  <Text style={{ fontSize: 18, color: '#FFF', fontWeight: '700' }}>
                    {settlement.defendantName.charAt(0)}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={{ ...typography.h2, color: colors.textPrimary, textAlign: 'right', lineHeight: 24 }}>
                  {settlement.defendantName}
                </Text>
                {settlement.caseNumber && (
                  <Text style={{
                    fontFamily: 'Heebo_500Medium',
                    fontSize: 11,
                    color: colors.textTertiary,
                    marginTop: 4,
                    letterSpacing: 0.3,
                  }}>
                    case {settlement.caseNumber}
                  </Text>
                )}
              </View>
              {/* Status badge in top-left (RTL leading is right, so left=trailing) */}
              <Badge label={status.label} color={status.color} />
            </View>

            {/* 2-column: payout range | deadline */}
            {(payoutText || settlement.claimDeadline) && (
              <View style={{
                flexDirection: 'row-reverse',
                justifyContent: 'space-between',
                paddingTop: spacing.md,
                borderTopWidth: 1,
                borderTopColor: colors.borderLight,
              }}>
                {payoutText && (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 11, color: colors.textTertiary, marginBottom: 2 }}>
                      טווח פיצוי
                    </Text>
                    <Text style={{
                      fontFamily: 'Heebo_700Bold',
                      fontSize: 16, color: colors.success,
                      letterSpacing: 0.2,
                    }}>
                      {payoutText}
                    </Text>
                  </View>
                )}
                {settlement.claimDeadline && days !== null && days >= 0 && (
                  <View style={{ alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 11, color: colors.textTertiary, marginBottom: 2 }}>
                      מועד אחרון
                    </Text>
                    <Text style={{
                      fontFamily: 'Heebo_700Bold',
                      fontSize: 15,
                      color: urgent ? colors.danger : colors.textPrimary,
                      letterSpacing: 0.2,
                    }}>
                      {formatDate(settlement.claimDeadline)}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </Card>
        </Animated.View>

        {/* ══ GREEN-ACCENT CARD — action-required copy + confidence meter ══ */}
        <Animated.View entering={FadeInDown.delay(100).duration(240)}>
          <Card
            accent={colors.success}
            style={{ backgroundColor: 'rgba(5, 150, 105, 0.06)' }}
          >
            <SectionTitle icon="📋" title="יש למלא טופס תביעה" color={colors.success} />
            <ConfidenceMeter percent={confidencePercent} color={colors.success} />
            <Text style={{
              ...typography.bodyBase,
              color: colors.textSecondary,
              textAlign: 'right',
              lineHeight: 22,
            }}>
              {settlement.eligibilityCriteria
                || 'לפי הפרופיל שלך — ייתכן שאתה זכאי לפיצוי. מלא את הטופס לבדיקת זכאות ממצה.'}
            </Text>
          </Card>
        </Animated.View>

        {/* ══ Deadline urgency banner (if close) ══ */}
        {days !== null && days >= 0 && urgent && (
          <Animated.View entering={FadeInDown.delay(140).duration(240)}>
            <Card
              accent={colors.danger}
              style={{ backgroundColor: 'rgba(220,38,38,0.06)' }}
            >
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm }}>
                <Text style={{ fontSize: 22 }}>🔥</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...typography.h3, color: colors.danger, textAlign: 'right' }}>
                    {days === 0 ? 'היום הוא המועד האחרון!'
                      : days === 1 ? 'נותר יום אחד בלבד!'
                      : `נותרו ${days} ימים להגשה`}
                  </Text>
                  <Text style={{ ...typography.caption, color: colors.textTertiary, textAlign: 'right', marginTop: 2 }}>
                    מועד אחרון: {formatDate(settlement.claimDeadline)}
                  </Text>
                </View>
              </View>
            </Card>
          </Animated.View>
        )}

        {/* ══ EligibilityPanel (AI classification engine) ══ */}
        <Animated.View entering={FadeInDown.delay(160).duration(240)}>
          <EligibilityPanel
            settlementId={settlement.id}
            onActionPress={(actionType) => {
              if (actionType === 'submit_form' && settlement.claimFormUrl) {
                Linking.openURL(settlement.claimFormUrl);
              }
            }}
          />
        </Animated.View>

        {/* ══ Meta stats — compact row ══ */}
        {(method || settlement.court) && (
          <Animated.View entering={FadeInDown.delay(200).duration(240)}>
            <Card>
              <View style={{ gap: spacing.sm }}>
                {method && (
                  <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                    <Text style={{ ...typography.bodySm, color: colors.textTertiary }}>
                      אופן תשלום
                    </Text>
                    <Text style={{ ...typography.bodySm, color: colors.textPrimary, fontWeight: '600' }}>
                      {method}
                    </Text>
                  </View>
                )}
                {settlement.court && (
                  <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                    <Text style={{ ...typography.bodySm, color: colors.textTertiary }}>
                      בית משפט
                    </Text>
                    <Text style={{ ...typography.bodySm, color: colors.textPrimary, fontWeight: '600' }}>
                      {settlement.court}
                    </Text>
                  </View>
                )}
              </View>
            </Card>
          </Animated.View>
        )}

        {/* ══ What happened ══ */}
        {settlement.summary && (
          <Animated.View entering={FadeInDown.delay(220).duration(240)}>
            <Card>
              <SectionTitle icon="📋" title="מה קרה?" />
              <Text style={{
                ...typography.bodyBase, color: colors.textSecondary,
                textAlign: 'right', lineHeight: 22,
              }}>
                {settlement.summary}
              </Text>
            </Card>
          </Animated.View>
        )}

        {/* ══ How to claim — with green accent ══ */}
        <Animated.View entering={FadeInDown.delay(260).duration(240)}>
          <Card accent={colors.success}>
            <SectionTitle icon="🎯" title="איך מממשים?" />
            {steps.length > 0 ? (
              <View>
                {steps.map((s, i) => (
                  <StepItem key={i} text={s} num={i + 1} total={steps.length} />
                ))}
              </View>
            ) : settlement.claimGuideHe ? (
              <Text style={{ ...typography.bodyBase, color: colors.textSecondary, textAlign: 'right', lineHeight: 22 }}>
                {settlement.claimGuideHe}
              </Text>
            ) : (
              <View style={{ alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm }}>
                <Text style={{ fontSize: 32 }}>🔜</Text>
                <Text style={{ ...typography.bodyBase, color: colors.textTertiary, textAlign: 'center' }}>
                  מדריך מימוש בהכנה
                </Text>
              </View>
            )}

            {settlement.claimFormUrl && (
              <View style={{ marginTop: spacing.md }}>
                <Button
                  label="פתח טופס מימוש"
                  variant="success"
                  size="md"
                  fullWidth
                  icon={<Text style={{ fontSize: 14 }}>🔗</Text>}
                  onPress={() => Linking.openURL(settlement.claimFormUrl!)}
                />
              </View>
            )}
          </Card>
        </Animated.View>

        {/* ══ Bottom CTAs ══ */}
        <Animated.View entering={FadeInDown.delay(300).duration(240)}>
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            {claimed ? (
              <View style={{
                height: 52, borderRadius: radius.lg,
                backgroundColor: colors.successBg,
                flexDirection: 'row-reverse', alignItems: 'center',
                justifyContent: 'center', gap: spacing.sm,
              }}>
                <Text style={{ fontSize: 18 }}>✅</Text>
                <Text style={{ ...typography.button, color: colors.success }}>
                  נשמר בהסדרים שלי
                </Text>
              </View>
            ) : (
              <Button
                label="מלא טופס תביעה"
                variant="primary"
                size="lg"
                fullWidth
                onPress={async () => {
                  try { await api.markSettlement(id, 'CLAIMED'); } catch {}
                  setClaimed(true);
                }}
              />
            )}

            {!claimed && (
              <Button
                label={saved ? '🔖 שמור ברשימה שלי' : 'שמור — הגש לי תזכורת'}
                variant="secondary"
                size="md"
                fullWidth
                onPress={async () => {
                  try { await api.markSettlement(id, 'INTERESTED'); } catch {}
                  setSaved(true);
                }}
              />
            )}
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

// Silence unused-var lint if a helper isn't used in a given build
void shadows;
