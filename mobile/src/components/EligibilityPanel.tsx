// ─────────────────────────────────────────────────────────────────────────────
//  EligibilityPanel.tsx
//  Shows the 4-state classification result for a settlement.
//  Covers: NO_ACTION_REQUIRED | ACTION_REQUIRED_WITH_DEADLINE |
//          CLAIM_FORM_REQUIRED | MAYBE_NEED_MORE_INFO
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, TextInput, Keyboard,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { colors, typography, spacing, radius, shadows, formatDate } from '@/theme';
import * as api from '@/services/api';
import type { ClassificationResult, ClassificationState } from '@/services/api';

// ── Config per state ──────────────────────────────────────────────────────────

const STATE_CONFIG: Record<ClassificationState, {
  icon: string; title: string; bg: string; border: string; textColor: string; accentBar: string;
}> = {
  CLAIM_FORM_REQUIRED: {
    icon: '📋', title: 'יש למלא טופס תביעה',
    bg: 'rgba(5,150,105,0.07)', border: 'rgba(5,150,105,0.25)',
    textColor: '#059669', accentBar: '#059669',
  },
  ACTION_REQUIRED_WITH_DEADLINE: {
    icon: '⚡', title: 'נדרשת פעולה לפני הדדליין',
    bg: 'rgba(220,38,38,0.07)', border: 'rgba(220,38,38,0.22)',
    textColor: '#DC2626', accentBar: '#DC2626',
  },
  NO_ACTION_REQUIRED: {
    icon: '✅', title: 'לא נדרשת פעולה כרגע',
    bg: 'rgba(37,99,235,0.06)', border: 'rgba(37,99,235,0.18)',
    textColor: '#2563EB', accentBar: '#2563EB',
  },
  MAYBE_NEED_MORE_INFO: {
    icon: '❓', title: 'צריך מידע נוסף',
    bg: 'rgba(217,119,6,0.07)', border: 'rgba(217,119,6,0.22)',
    textColor: '#D97706', accentBar: '#D97706',
  },
};

const ACTION_LABEL: Record<string, string> = {
  submit_form:    'מלא טופס תביעה',
  upload_docs:    'העלה מסמכים',
  opt_out:        'פרוש מההסדר',
  object:         'הגש התנגדות',
  open_case:      'פתח את ההסדר',
  answer_questions: 'ענה על שאלות',
  wait:           'המתן לעדכון',
  none:           '',
  other:          'פעל עכשיו',
};

// ── Confidence meter ──────────────────────────────────────────────────────────

function ConfidenceMeter({ value, color }: { value: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm }}>
      <View style={{
        flex: 1, height: 5, borderRadius: 3,
        backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden',
      }}>
        <View style={{
          height: '100%', borderRadius: 3,
          backgroundColor: color,
          width: `${value}%`,
        }} />
      </View>
      <Text style={{ ...typography.caption, color: colors.textTertiary, width: 36, textAlign: 'right' }}>
        {value}% ודאות
      </Text>
    </View>
  );
}

// ── Follow-up Q&A inline ──────────────────────────────────────────────────────

function FollowUpForm({ questions, onSubmit, loading }: {
  questions: string[];
  onSubmit: (answers: { question: string; answer: string }[]) => void;
  loading: boolean;
}) {
  const [answers, setAnswers] = useState<string[]>(questions.map(() => ''));

  function handleSubmit() {
    Keyboard.dismiss();
    const qa = questions.map((q, i) => ({ question: q, answer: answers[i] }))
      .filter(a => a.answer.trim().length > 0);
    if (qa.length > 0) onSubmit(qa);
  }

  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
      {questions.map((q, i) => (
        <View key={i} style={{ gap: spacing.xs }}>
          <Text style={{ ...typography.labelSm, color: colors.textSecondary, textAlign: 'right' }}>
            {q}
          </Text>
          <TextInput
            value={answers[i]}
            onChangeText={v => setAnswers(prev => { const n = [...prev]; n[i] = v; return n; })}
            placeholder="תשובה..."
            textAlign="right"
            style={{
              borderWidth: 1, borderColor: colors.glassBorder,
              borderRadius: radius.md, padding: spacing.sm,
              ...typography.bodyBase, color: colors.textPrimary,
              backgroundColor: 'rgba(255,255,255,0.7)',
            }}
          />
        </View>
      ))}
      <Pressable
        onPress={handleSubmit}
        disabled={loading || answers.every(a => !a.trim())}
        style={{
          height: 44, borderRadius: radius.lg,
          backgroundColor: colors.primary,
          alignItems: 'center', justifyContent: 'center',
          ...shadows.button,
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading
          ? <ActivityIndicator size="small" color="#FFF" />
          : <Text style={{ ...typography.labelMd, color: '#FFF', fontWeight: '600' }}>שלח ובדוק מחדש</Text>}
      </Pressable>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  settlementId: string;
  onActionPress?: (actionType: string) => void;
}

export default function EligibilityPanel({ settlementId, onActionPress }: Props) {
  const [result, setResult]     = useState<ClassificationResult | null>(null);
  const [loading, setLoading]   = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError]       = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const r = await api.classifySettlement(settlementId);
        if (!cancelled) setResult(r);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [settlementId]);

  async function handleFollowUp(answers: { question: string; answer: string }[]) {
    setReloading(true);
    try {
      const r = await api.reclassifyWithAnswers(settlementId, answers);
      setResult(r);
    } catch { /* keep old result */ } finally {
      setReloading(false);
    }
  }

  // ── Loading ──
  if (loading) {
    return (
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.glass, borderRadius: radius.lg,
        borderWidth: 1, borderColor: colors.glassBorder,
        padding: spacing.md,
      }}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={{ ...typography.bodySm, color: colors.textTertiary }}>
          בודק זכאות שלך...
        </Text>
      </View>
    );
  }

  // ── Error / unavailable ──
  if (error || !result) return null;

  const cfg = STATE_CONFIG[result.classification];
  const actionLabel = ACTION_LABEL[result.user_action.action_type] || '';
  const eligibilityIcon = result.eligibility.likely_eligible === true
    ? '✅' : result.eligibility.likely_eligible === false ? '❌' : '❓';

  return (
    <Animated.View entering={FadeInDown.duration(300)}>
      <View style={{
        borderRadius: radius.xl, overflow: 'hidden',
        borderWidth: 1, borderColor: cfg.border,
        backgroundColor: cfg.bg,
        ...shadows.card,
      }}>
        {/* Accent bar on right (RTL) */}
        <View style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: 4, backgroundColor: cfg.accentBar,
        }} />

        <View style={{ padding: spacing.base, paddingRight: spacing.lg }}>

          {/* Header: icon + title + confidence */}
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ fontSize: 22 }}>{cfg.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ ...typography.h3, color: cfg.textColor, textAlign: 'right' }}>
                {cfg.title}
              </Text>
            </View>
          </View>

          <ConfidenceMeter value={result.confidence} color={cfg.accentBar} />

          {/* Reason */}
          <Text style={{
            ...typography.bodyBase, color: colors.textSecondary,
            textAlign: 'right', lineHeight: 22, marginTop: spacing.sm,
          }}>
            {result.reason_hebrew}
          </Text>

          {/* Eligibility bullets */}
          {result.eligibility.why?.length > 0 && (
            <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
              {result.eligibility.why.map((w, i) => (
                <View key={i} style={{ flexDirection: 'row-reverse', gap: spacing.xs, alignItems: 'flex-start' }}>
                  <Text style={{ color: cfg.textColor, fontSize: 13, lineHeight: 20 }}>•</Text>
                  <Text style={{ ...typography.bodySm, color: colors.textSecondary, textAlign: 'right', flex: 1, lineHeight: 20 }}>
                    {w}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Deadline chip */}
          {result.deadline?.exists && result.deadline.date && (
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs,
              marginTop: spacing.sm, padding: spacing.sm,
              backgroundColor: 'rgba(220,38,38,0.09)', borderRadius: radius.md,
              borderWidth: 1, borderColor: 'rgba(220,38,38,0.18)',
            }}>
              <Text style={{ fontSize: 16 }}>📅</Text>
              <Text style={{ ...typography.labelSm, color: colors.danger, fontWeight: '700' }}>
                מועד אחרון: {formatDate(result.deadline.date)}
              </Text>
            </View>
          )}

          {/* Action button */}
          {result.user_action.required && actionLabel ? (
            <Pressable
              onPress={() => onActionPress?.(result.user_action.action_type)}
              style={{
                marginTop: spacing.md, height: 46, borderRadius: radius.lg,
                backgroundColor: cfg.accentBar,
                flexDirection: 'row-reverse', alignItems: 'center',
                justifyContent: 'center', gap: spacing.sm,
                ...shadows.button,
              }}
            >
              <Text style={{ ...typography.labelLg, color: '#FFF', fontWeight: '600' }}>
                {actionLabel}
              </Text>
            </Pressable>
          ) : null}

          {/* Follow-up questions */}
          {result.classification === 'MAYBE_NEED_MORE_INFO' &&
           result.follow_up_questions?.length > 0 && (
            <View style={{
              marginTop: spacing.md, paddingTop: spacing.md,
              borderTopWidth: 1, borderTopColor: colors.borderLight,
            }}>
              <Text style={{ ...typography.labelSm, color: colors.textTertiary, textAlign: 'right', marginBottom: spacing.sm }}>
                כדי לדייק — ענה בקצרה:
              </Text>
              <FollowUpForm
                questions={result.follow_up_questions}
                onSubmit={handleFollowUp}
                loading={reloading}
              />
            </View>
          )}

        </View>
      </View>
    </Animated.View>
  );
}
