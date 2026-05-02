// ─────────────────────────────────────────────────────────────────────────────
//  app/admin/pending.tsx — Admin queue: Incubator cases awaiting review.
//  Available only to users with role === 'ADMIN'. Lives inside the regular app
//  (no separate admin panel yet) and is reachable from the profile screen.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, ActivityIndicator,
  StatusBar, Alert, Platform, RefreshControl,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { colors, typography, spacing, radius, shadows } from '@/theme';
import * as api from '@/services/api';
import type { PendingIncubatorCase } from '@/services/api';

type ActionMode = 'idle' | 'reject' | 'revisions';

export default function AdminPendingScreen() {
  const [cases, setCases]       = useState<PendingIncubatorCase[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.getPendingCases();
      setCases(res.cases);
    } catch (e: any) {
      setError(e?.message ?? 'שגיאה בטעינת קייסים');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <Stack.Screen options={{ headerShown: true, title: 'קייסים ממתינים לאישור', headerBackTitle: 'חזור' }} />
      <StatusBar barStyle="dark-content" />

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.base }}>
          <Text style={{ ...typography.bodyBase, color: colors.danger, textAlign: 'center' }}>{error}</Text>
          <Pressable onPress={load} style={{ marginTop: spacing.md, padding: spacing.sm }}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>נסה שוב</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.base, paddingBottom: 120, gap: spacing.base }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
        >
          {cases.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: spacing.xxl }}>
              <Text style={{ fontSize: 48 }}>📭</Text>
              <Text style={{ ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm, textAlign: 'center' }}>
                אין קייסים ממתינים
              </Text>
              <Text style={{ ...typography.bodyBase, color: colors.textTertiary, marginTop: 4, textAlign: 'center' }}>
                כל היוזמות עודכנו
              </Text>
            </View>
          ) : (
            cases.map(c => (
              <CaseCard key={c.id} initial={c} onChanged={load} />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── Case card ───────────────────────────────────────────────────────────────

function CaseCard({ initial, onChanged }: { initial: PendingIncubatorCase; onChanged: () => void }) {
  const [mode, setMode]       = useState<ActionMode>('idle');
  const [reason, setReason]   = useState('');
  const [working, setWorking] = useState(false);

  const founderName = initial.founder?.profile?.displayName ?? initial.founder?.phone ?? '—';

  async function handleApprove() {
    Alert.alert('אישור קייס', 'לאשר את הקייס ולהעביר ל-LIVE?', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'אשר', style: 'default',
        onPress: async () => {
          try {
            setWorking(true);
            await api.approveCase(initial.id);
            onChanged();
          } catch (e: any) {
            Alert.alert('שגיאה', e?.message ?? 'אישור נכשל');
          } finally {
            setWorking(false);
          }
        },
      },
    ]);
  }

  async function handleSubmitReason() {
    if (reason.trim().length < 3) {
      Alert.alert('נדרש הסבר', 'כתוב לפחות 3 תווים');
      return;
    }
    try {
      setWorking(true);
      if (mode === 'reject')   await api.rejectCase(initial.id, reason.trim());
      if (mode === 'revisions') await api.requestCaseRevisions(initial.id, reason.trim());
      setMode('idle');
      setReason('');
      onChanged();
    } catch (e: any) {
      Alert.alert('שגיאה', e?.message ?? 'פעולה נכשלה');
    } finally {
      setWorking(false);
    }
  }

  return (
    <View style={{
      backgroundColor: '#FFF', borderRadius: radius.xl, padding: spacing.base,
      ...shadows.card, borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)', gap: spacing.sm,
    }}>
      {/* Header: title + status */}
      <Text style={{ ...typography.h3, color: colors.textPrimary, textAlign: 'right' }}>
        {initial.title}
      </Text>

      {/* Duplicate-detection flag (Q6): surfaced to admin for informed decision */}
      {initial.similarLiveCount > 0 && (
        <View style={{
          backgroundColor: 'rgba(234, 179, 8, 0.12)', borderRadius: radius.md,
          padding: spacing.sm, flexDirection: 'row-reverse', gap: spacing.xs, alignItems: 'center',
        }}>
          <Text style={{ fontSize: 16 }}>⚠️</Text>
          <Text style={{ ...typography.caption, color: '#92400E', textAlign: 'right', flex: 1 }}>
            קיימים {initial.similarLiveCount} קייסים פעילים נוספים נגד {initial.defendantCompany} — ייתכן כפיל.
          </Text>
        </View>
      )}

      {/* AI analysis (if analyzer ran on submit) */}
      {initial.aiAnalysis && (
        <AiAnalysisPanel analysis={initial.aiAnalysis} />
      )}

      {/* Metadata rows */}
      <MetaRow label="חברה נתבעת"   value={initial.defendantCompany} />
      <MetaRow label="סוג עוולה"    value={CLAIM_TYPE_HE[initial.legalClaimType]} />
      <MetaRow label="נזק משוער"    value={`₪ ${initial.damageEstimateNis.toLocaleString('he-IL')}`} />
      <MetaRow label="יוזם"         value={founderName} />
      <MetaRow label="חברים / ראיות" value={`${initial._count.members} / ${initial._count.evidence}`} />

      {/* Narrative */}
      <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)', paddingTop: spacing.sm }}>
        <Text style={{ ...typography.caption, color: colors.textTertiary, textAlign: 'right' }}>תיאור</Text>
        <Text style={{ ...typography.bodyBase, color: colors.textPrimary, textAlign: 'right', marginTop: 2 }}>
          {initial.narrative}
        </Text>
      </View>

      {/* Actions */}
      {mode === 'idle' ? (
        <View style={{ flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.xs }}>
          <ActionBtn color={colors.success} label="אשר"          onPress={handleApprove}              disabled={working} />
          <ActionBtn color="#D97706"        label="בקש שינויים" onPress={() => setMode('revisions')} disabled={working} />
          <ActionBtn color={colors.danger}  label="דחה"          onPress={() => setMode('reject')}    disabled={working} />
        </View>
      ) : (
        <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
          <Text style={{ ...typography.labelSm, color: colors.textSecondary, textAlign: 'right' }}>
            {mode === 'reject' ? 'סיבת דחייה' : 'מה צריך לשפר?'}
          </Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={3}
            autoFocus
            textAlign="right"
            placeholder="הסבר קצר..."
            style={{
              ...typography.bodyBase,
              borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)',
              borderRadius: radius.md, padding: spacing.sm,
              minHeight: 70, textAlignVertical: 'top',
              backgroundColor: '#FAFAFA',
            }}
          />
          <View style={{ flexDirection: 'row-reverse', gap: spacing.sm }}>
            <ActionBtn
              color={mode === 'reject' ? colors.danger : '#D97706'}
              label={working ? '...' : (mode === 'reject' ? 'שלח דחייה' : 'שלח בקשת שינוי')}
              onPress={handleSubmitReason}
              disabled={working}
            />
            <ActionBtn
              color={colors.textTertiary}
              label="ביטול"
              onPress={() => { setMode('idle'); setReason(''); }}
              disabled={working}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
      <Text style={{ ...typography.caption, color: colors.textTertiary }}>{label}</Text>
      <Text style={{ ...typography.labelSm, color: colors.textPrimary, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

function ActionBtn({ color, label, onPress, disabled }: {
  color: string; label: string; onPress: () => void; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1, paddingVertical: 10, borderRadius: radius.md,
        backgroundColor: disabled ? 'rgba(0,0,0,0.1)' : color,
        alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Text style={{ ...typography.labelSm, color: '#FFF', fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

// ── AI analysis panel ───────────────────────────────────────────────────────

function AiAnalysisPanel({ analysis }: { analysis: api.CaseAnalysis }) {
  const score = analysis.powerScore;
  const scoreColor = score >= 70 ? '#059669' : score >= 50 ? '#D97706' : '#DC2626';
  const recLabel = REC_HE[analysis.recommendation] ?? analysis.recommendation;
  const recColor = analysis.recommendation === 'APPROVE'   ? '#059669'
                 : analysis.recommendation === 'REVISIONS' ? '#D97706' : '#DC2626';

  return (
    <View style={{
      backgroundColor: 'rgba(26,86,219,0.04)',
      borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs,
      borderWidth: 1, borderColor: 'rgba(26,86,219,0.15)',
    }}>
      <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs }}>
          <Text style={{ fontSize: 14 }}>🤖</Text>
          <Text style={{ ...typography.labelSm, color: colors.textSecondary, fontWeight: '700' }}>
            ניתוח AI
          </Text>
        </View>
        <View style={{
          backgroundColor: recColor, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 999,
        }}>
          <Text style={{ ...typography.caption, color: '#FFF', fontWeight: '700' }}>{recLabel}</Text>
        </View>
      </View>

      {/* Score bar */}
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm }}>
        <Text style={{ ...typography.h3, color: scoreColor, fontWeight: '700' }}>
          {score.toFixed(1)}
        </Text>
        <Text style={{ ...typography.caption, color: colors.textTertiary }}>/100</Text>
        <View style={{ flex: 1, height: 6, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 999, overflow: 'hidden' }}>
          <View style={{ width: `${score}%`, height: '100%', backgroundColor: scoreColor }} />
        </View>
        <Text style={{ ...typography.caption, color: colors.textTertiary }}>
          קושי משפטי {analysis.legalDifficulty}/10
        </Text>
      </View>

      {/* Summary */}
      <Text style={{ ...typography.bodyBase, color: colors.textPrimary, textAlign: 'right' }}>
        {analysis.summary}
      </Text>

      {/* 5 factors */}
      <View style={{ gap: 4, marginTop: 4 }}>
        <FactorBar label="הוכחת פגיעה"     value={analysis.factors.harmProof} />
        <FactorBar label="פירוט תיאור"      value={analysis.factors.narrativeDetail} />
        <FactorBar label="סבירות משפטית"  value={analysis.factors.legalPlausibility} />
        <FactorBar label="שלמות טופס"       value={analysis.factors.formCompleteness} />
        <FactorBar label="פוטנציאל נפגעים" value={analysis.factors.affectedPotential} />
      </View>

      {/* Strengths / weaknesses */}
      {analysis.strengths?.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={{ ...typography.caption, color: '#059669', textAlign: 'right', fontWeight: '700' }}>
            חוזקות:
          </Text>
          {analysis.strengths.map((s, i) => (
            <Text key={i} style={{ ...typography.caption, color: colors.textPrimary, textAlign: 'right' }}>
              • {s}
            </Text>
          ))}
        </View>
      )}

      {analysis.weaknesses?.length > 0 && (
        <View>
          <Text style={{ ...typography.caption, color: '#D97706', textAlign: 'right', fontWeight: '700' }}>
            חולשות:
          </Text>
          {analysis.weaknesses.map((w, i) => (
            <Text key={i} style={{ ...typography.caption, color: colors.textPrimary, textAlign: 'right' }}>
              • {w}
            </Text>
          ))}
        </View>
      )}

      {/* Flags */}
      {analysis.flags?.length > 0 && (
        <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {analysis.flags.map(f => (
            <View key={f} style={{
              backgroundColor: 'rgba(220,38,38,0.10)',
              paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radius.sm,
            }}>
              <Text style={{ ...typography.caption, color: '#B91C1C', fontWeight: '600' }}>
                {FLAG_HE[f] ?? f}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function FactorBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const color = clamped >= 70 ? '#059669' : clamped >= 45 ? '#D97706' : '#DC2626';
  return (
    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs }}>
      <Text style={{ ...typography.caption, color: colors.textTertiary, width: 110, textAlign: 'right' }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 4, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 999, overflow: 'hidden' }}>
        <View style={{ width: `${clamped}%`, height: '100%', backgroundColor: color }} />
      </View>
      <Text style={{ ...typography.caption, color: colors.textPrimary, width: 30, textAlign: 'left', fontWeight: '600' }}>
        {Math.round(clamped)}
      </Text>
    </View>
  );
}

const REC_HE: Record<api.CaseAnalysis['recommendation'], string> = {
  APPROVE:   'המלצה: אשר',
  REVISIONS: 'המלצה: בקש שינויים',
  REJECT:    'המלצה: דחה',
};

const FLAG_HE: Record<string, string> = {
  MISSING_EVIDENCE:            'אין ראיות',
  VAGUE_NARRATIVE:             'תיאור עמום',
  WEAK_LEGAL_BASIS:            'עילה חלשה',
  PERSONAL_DISPUTE:            'סכסוך אישי',
  STATUTE_OF_LIMITATIONS:      'חשש להתיישנות',
  DAMAGE_ESTIMATE_UNREALISTIC: 'סכום נזק לא עקבי',
  DEFENDANT_UNCLEAR:           'נתבע לא ברור',
  INCOMPLETE_FORM:             'טופס חסר',
  DUPLICATE_SUSPECTED:         'כפיל אפשרי',
};

const CLAIM_TYPE_HE: Record<api.LegalClaimType, string> = {
  MISREPRESENTATION:  'הטעיה',
  OVERCHARGING:       'חיוב יתר',
  DEFECTIVE_PRODUCT:  'מוצר פגום',
  POOR_SERVICE:       'שירות לקוי',
  DISCRIMINATION:     'אפליה',
  PRIVACY_VIOLATION:  'פגיעה בפרטיות',
  OTHER:              'אחר',
};
