// ─────────────────────────────────────────────────────────────────────────────
//  app/claim/[id].tsx — Multi-step claim submission form
//  Steps: זכאות → מסמכים → פרטי תשלום → סקירה והגשה
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, Pressable, SafeAreaView,
  StatusBar, ActivityIndicator,
} from 'react-native';
import Animated, { FadeInDown, FadeInRight, FadeOutLeft } from 'react-native-reanimated';
import { useLocalSearchParams, router } from 'expo-router';
import { colors, typography, spacing, radius, shadows } from '@/theme';
import BrandLogo from '@/components/BrandLogo';
import * as api from '@/services/api';
import type { Lawsuit } from '@/services/api';

// ── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { id: 'eligibility', label: 'זכאות' },
  { id: 'documents',   label: 'מסמכים' },
  { id: 'payment',     label: 'פרטי תשלום' },
  { id: 'review',      label: 'סקירה והגשה' },
] as const;

type StepId = typeof STEPS[number]['id'];

// ── Radio button ─────────────────────────────────────────────────────────────

function RadioGroup({
  question, value, onChange,
}: {
  question: string;
  value: string | null;
  onChange: (v: string) => void;
}) {
  const options = ['כן', 'לא', 'לא בטוח'];
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ ...typography.labelLg, color: colors.textPrimary, textAlign: 'right', marginBottom: spacing.xs }}>
        {question}
      </Text>
      {options.map(opt => (
        <Pressable
          key={opt}
          onPress={() => onChange(opt)}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: colors.bgWhite, borderRadius: radius.md,
            borderWidth: 1.5,
            borderColor: value === opt ? colors.primary : colors.borderDefault,
            padding: spacing.base,
          }}
        >
          <View style={{
            width: 20, height: 20, borderRadius: 10,
            borderWidth: 2, borderColor: value === opt ? colors.primary : colors.borderDefault,
            alignItems: 'center', justifyContent: 'center',
          }}>
            {value === opt && (
              <View style={{
                width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary,
              }} />
            )}
          </View>
          <Text style={{ ...typography.labelMd, color: colors.textPrimary }}>{opt}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── Step: Eligibility ────────────────────────────────────────────────────────

function EligibilityStep({ answers, setAnswers }: {
  answers: Record<string, string | null>;
  setAnswers: (a: Record<string, string | null>) => void;
}) {
  function set(key: string, val: string) {
    setAnswers({ ...answers, [key]: val });
  }
  return (
    <Animated.View entering={FadeInRight.duration(250)} style={{ gap: spacing.xl }}>
      <View>
        <Text style={{ ...typography.h2, color: colors.textPrimary, textAlign: 'right', marginBottom: spacing.xs }}>
          זכאות
        </Text>
        <Text style={{ ...typography.bodyBase, color: colors.textTertiary, textAlign: 'right' }}>
          ענו על השאלות הבאות כדי לדעת את זכאותכם
        </Text>
      </View>

      <RadioGroup
        question="האם יש ברשותך מסמכים תומכים כגון קבלה?"
        value={answers.hasDocuments ?? null}
        onChange={v => set('hasDocuments', v)}
      />

      <RadioGroup
        question="האם שילמת עבור השירות/המוצר הנדון?"
        value={answers.hasPaid ?? null}
        onChange={v => set('hasPaid', v)}
      />

      <RadioGroup
        question="האם אתה תושב ישראל?"
        value={answers.isResident ?? null}
        onChange={v => set('isResident', v)}
      />
    </Animated.View>
  );
}

// ── Step: Documents ──────────────────────────────────────────────────────────

function DocumentsStep() {
  return (
    <Animated.View entering={FadeInRight.duration(250)} style={{ gap: spacing.xl }}>
      <View>
        <Text style={{ ...typography.h2, color: colors.textPrimary, textAlign: 'right', marginBottom: spacing.xs }}>
          מסמכים
        </Text>
        <Text style={{ ...typography.bodyBase, color: colors.textTertiary, textAlign: 'right' }}>
          צרפו את המסמכים הרלוונטיים לתמיכה בבקשה
        </Text>
      </View>

      {[
        { icon: '🧾', label: 'קבלה או חשבונית', required: true },
        { icon: '📄', label: 'אישור רכישה', required: false },
        { icon: '🪪', label: 'תעודת זהות', required: true },
      ].map(doc => (
        <Pressable
          key={doc.label}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: colors.bgWhite, borderRadius: radius.lg,
            borderWidth: 1, borderColor: colors.borderDefault,
            padding: spacing.base, ...shadows.card,
          }}
        >
          <View style={{
            paddingHorizontal: spacing.sm, paddingVertical: 4,
            backgroundColor: colors.bgBlue, borderRadius: radius.pill,
          }}>
            <Text style={{ ...typography.caption, color: colors.primary, fontWeight: '600' }}>
              + העלה
            </Text>
          </View>

          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ fontSize: 20 }}>{doc.icon}</Text>
            <View>
              <Text style={{ ...typography.labelMd, color: colors.textPrimary, textAlign: 'right' }}>
                {doc.label}
              </Text>
              {doc.required && (
                <Text style={{ ...typography.caption, color: colors.danger, textAlign: 'right' }}>
                  חובה
                </Text>
              )}
            </View>
          </View>
        </Pressable>
      ))}
    </Animated.View>
  );
}

// ── Step: Payment ─────────────────────────────────────────────────────────────

function PaymentStep({ lawsuit }: { lawsuit: Lawsuit }) {
  return (
    <Animated.View entering={FadeInRight.duration(250)} style={{ gap: spacing.xl }}>
      <View>
        <Text style={{ ...typography.h2, color: colors.textPrimary, textAlign: 'right', marginBottom: spacing.xs }}>
          פרטי תשלום
        </Text>
        <Text style={{ ...typography.bodyBase, color: colors.textTertiary, textAlign: 'right' }}>
          הפיצוי יועבר לחשבון שתגדירו לאחר אישור הבקשה
        </Text>
      </View>

      {/* Estimated payout */}
      {lawsuit.payoutMinILS && lawsuit.payoutMaxILS && (
        <View style={{
          padding: spacing.base, backgroundColor: '#F0FDF4',
          borderRadius: radius.lg, borderWidth: 1, borderColor: '#16A34A20',
          alignItems: 'center',
        }}>
          <Text style={{ ...typography.caption, color: colors.textTertiary, marginBottom: 4 }}>
            פיצוי משוער עבורך
          </Text>
          <Text style={{ ...typography.displayMd, color: '#16A34A', fontWeight: '700' }}>
            ₪{lawsuit.payoutMinILS} – ₪{lawsuit.payoutMaxILS}
          </Text>
        </View>
      )}

      {[
        { icon: '🏦', label: 'העברה בנקאית' },
        { icon: '💳', label: 'אשראי' },
        { icon: '📱', label: 'Bit / PayBox' },
      ].map(method => (
        <Pressable
          key={method.label}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: colors.bgWhite, borderRadius: radius.lg,
            borderWidth: 1, borderColor: colors.borderDefault,
            padding: spacing.base, ...shadows.card,
          }}
        >
          <Text style={{ ...typography.caption, color: colors.textTertiary }}>{'>'}</Text>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ fontSize: 20 }}>{method.icon}</Text>
            <Text style={{ ...typography.labelLg, color: colors.textPrimary }}>{method.label}</Text>
          </View>
        </Pressable>
      ))}
    </Animated.View>
  );
}

// ── Step: Review ─────────────────────────────────────────────────────────────

function ReviewStep({ lawsuit, onSubmit, submitting }: {
  lawsuit:    Lawsuit;
  onSubmit:   () => void;
  submitting: boolean;
}) {
  return (
    <Animated.View entering={FadeInRight.duration(250)} style={{ gap: spacing.xl }}>
      <View>
        <Text style={{ ...typography.h2, color: colors.textPrimary, textAlign: 'right', marginBottom: spacing.xs }}>
          סקירה והגשה
        </Text>
        <Text style={{ ...typography.bodyBase, color: colors.textTertiary, textAlign: 'right' }}>
          בדקו את הפרטים לפני שתגישו
        </Text>
      </View>

      <View style={{
        backgroundColor: colors.bgWhite, borderRadius: radius.lg,
        borderWidth: 1, borderColor: colors.borderDefault, ...shadows.card,
        padding: spacing.base, gap: spacing.md,
      }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm }}>
          <BrandLogo slug={lawsuit.defendantSlug} name={lawsuit.defendantName} size={44} />
          <View>
            <Text style={{ ...typography.h3, color: colors.textPrimary, textAlign: 'right' }}>
              {lawsuit.defendantName}
            </Text>
            <Text style={{ ...typography.bodySm, color: colors.textTertiary, textAlign: 'right' }}>
              {lawsuit.caseNumber}
            </Text>
          </View>
        </View>

        {lawsuit.eligibilityCriteria ? (
          <View>
            <Text style={{ ...typography.labelSm, color: colors.textTertiary, textAlign: 'right', marginBottom: 4 }}>
              תנאי זכאות
            </Text>
            <Text style={{ ...typography.bodyBase, color: colors.textPrimary, textAlign: 'right', lineHeight: 22 }}>
              {lawsuit.eligibilityCriteria}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{
        padding: spacing.md, backgroundColor: colors.bgBlue,
        borderRadius: radius.md,
      }}>
        <Text style={{ ...typography.bodyBase, color: colors.primary, textAlign: 'right', lineHeight: 22 }}>
          בלחיצה על "הגשת בקשה" אתם מאשרים שהמידע שסיפקתם מדויק ומאשרים את תנאי השימוש.
        </Text>
      </View>

      <Pressable
        onPress={onSubmit}
        disabled={submitting}
        style={{
          height: 52, borderRadius: radius.lg,
          backgroundColor: submitting ? colors.borderDefault : '#16A34A',
          alignItems: 'center', justifyContent: 'center',
          ...(submitting ? {} : shadows.button),
        }}
      >
        <Text style={{ ...typography.button, color: '#FFFFFF' }}>
          {submitting ? '...' : 'הגשת בקשה'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function ClaimSubmissionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [lawsuit,    setLawsuit]    = useState<Lawsuit | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [step,       setStep]       = useState<StepId>('eligibility');
  const [answers,    setAnswers]    = useState<Record<string, string | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);

  useEffect(() => {
    // 404 here just means the form was opened with a stale id (deep-link or
    // back-stack from a deleted/migrated lawsuit). Render the "not found" UI
    // below instead of spamming console.error.
    api.getLawsuitById(id)
      .then(setLawsuit)
      .catch(() => setLawsuit(null))
      .finally(() => setLoading(false));
  }, [id]);

  const currentIndex = STEPS.findIndex(s => s.id === step);
  const [submitError, setSubmitError] = useState(false);

  // Validation: check if current step is complete enough to proceed
  const canProceed = (() => {
    if (step === 'eligibility') {
      return !!(answers.hasDocuments && answers.hasPaid && answers.isResident);
    }
    return true; // documents & payment are optional for now
  })();

  function goNext() {
    const next = STEPS[currentIndex + 1];
    if (next) setStep(next.id);
  }

  function goPrev() {
    const prev = STEPS[currentIndex - 1];
    if (prev) setStep(prev.id);
    else router.back();
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(false);
    try {
      await api.submitClaim(id, 'JOINED');
      setSubmitted(true);
    } catch {
      setSubmitError(true);
      // Show error but don't block — allow retry
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
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgPage, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ ...typography.bodyLg, color: colors.textTertiary }}>התביעה לא נמצאה</Text>
      </SafeAreaView>
    );
  }

  // Success state
  if (submitted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgPage, justifyContent: 'center', alignItems: 'center', padding: spacing.xl }}>
        <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: 'center', gap: spacing.base }}>
          <View style={{
            width: 72, height: 72, borderRadius: 36,
            backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 36 }}>✅</Text>
          </View>
          <Text style={{ ...typography.displayMd, color: colors.textPrimary, textAlign: 'center' }}>
            הבקשה הוגשה!
          </Text>
          <Text style={{ ...typography.bodyLg, color: colors.textTertiary, textAlign: 'center', lineHeight: 24 }}>
            נעקוב אחרי הבקשה שלך{'\n'}ונודיע לך כשיהיו עדכונים
          </Text>
          <Pressable
            onPress={() => router.replace('/(tabs)/claims')}
            style={{
              marginTop: spacing.xl, height: 52, paddingHorizontal: spacing.xxl,
              borderRadius: radius.lg, backgroundColor: colors.primary,
              alignItems: 'center', justifyContent: 'center', ...shadows.button,
            }}
          >
            <Text style={{ ...typography.button, color: '#FFFFFF' }}>לתביעות שלי</Text>
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: spacing.base, paddingVertical: spacing.md,
        borderBottomWidth: 1, borderBottomColor: colors.borderLight,
      }}>
        <Pressable onPress={goPrev} hitSlop={12}>
          <Text style={{ fontSize: 22, color: colors.textTertiary }}>✕</Text>
        </Pressable>
        <Text style={{ ...typography.h2, color: colors.textPrimary }}>הגשת בקשה</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Step tabs */}
      <View style={{
        flexDirection: 'row-reverse', borderBottomWidth: 1, borderBottomColor: colors.borderLight,
      }}>
        {STEPS.map((s, i) => {
          const isActive  = s.id === step;
          const isDone    = i < currentIndex;
          return (
            <Pressable
              key={s.id}
              onPress={() => i <= currentIndex && setStep(s.id)}
              style={{
                flex: 1, paddingVertical: spacing.sm, alignItems: 'center',
                borderBottomWidth: isActive ? 2 : 0,
                borderBottomColor: colors.primary,
              }}
            >
              <Text style={{
                ...typography.caption, fontWeight: '600',
                color: isActive ? colors.primary : isDone ? '#16A34A' : colors.textDisabled,
              }}>
                {isDone ? '✓ ' : ''}{s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Step content */}
      <ScrollView
        contentContainerStyle={{ padding: spacing.base, paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        {step === 'eligibility' && (
          <EligibilityStep answers={answers} setAnswers={setAnswers} />
        )}
        {step === 'documents' && <DocumentsStep />}
        {step === 'payment'   && <PaymentStep lawsuit={lawsuit} />}
        {step === 'review'    && (
          <ReviewStep lawsuit={lawsuit} onSubmit={handleSubmit} submitting={submitting} />
        )}
      </ScrollView>

      {/* Error toast */}
      {submitError && (
        <View style={{
          position: 'absolute', bottom: 100, left: spacing.base, right: spacing.base,
          padding: spacing.base, backgroundColor: colors.dangerBg,
          borderRadius: radius.lg, borderWidth: 1, borderColor: '#FCA5A540',
          flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm,
        }}>
          <Text style={{ fontSize: 18 }}>⚠️</Text>
          <Text style={{ ...typography.labelMd, color: colors.danger, textAlign: 'right', flex: 1 }}>
            שגיאה בשליחה. אנא נסו שוב.
          </Text>
          <Pressable onPress={() => setSubmitError(false)} hitSlop={12}>
            <Text style={{ fontSize: 14, color: colors.danger }}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* Bottom CTA (except review step which has its own button) */}
      {step !== 'review' && (
        <View style={{
          paddingHorizontal: spacing.base, paddingBottom: spacing.xl, paddingTop: spacing.sm,
          borderTopWidth: 1, borderTopColor: colors.borderLight,
          backgroundColor: colors.bgWhite,
        }}>
          {!canProceed && step === 'eligibility' && (
            <Text style={{ ...typography.caption, color: colors.textTertiary, textAlign: 'center', marginBottom: spacing.sm }}>
              ענו על כל השאלות כדי להמשיך
            </Text>
          )}
          <Pressable
            onPress={goNext}
            disabled={!canProceed}
            style={{
              height: 52, borderRadius: radius.lg,
              backgroundColor: canProceed ? colors.primary : colors.borderDefault,
              alignItems: 'center', justifyContent: 'center',
              ...(canProceed ? shadows.button : {}),
            }}
          >
            <Text style={{
              ...typography.button,
              color: canProceed ? '#FFFFFF' : colors.textDisabled,
            }}>הבא</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}
