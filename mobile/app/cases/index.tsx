// ─────────────────────────────────────────────────────────────────────────────
//  app/cases/index.tsx — Founder's list of their own Incubator cases.
//  Shows status, AI powerScore (if analyzed), and lets them open /cases/new.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator,
  StatusBar, RefreshControl,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { colors, typography, spacing, radius, shadows } from '@/theme';
import * as api from '@/services/api';
import type { IncubatorCase, IncubatorCaseStatus } from '@/services/api';

const STATUS_HE: Record<IncubatorCaseStatus, { label: string; color: string; bg: string }> = {
  DRAFT:               { label: 'טיוטה',             color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
  PENDING_REVIEW:      { label: 'ממתין לבדיקה',     color: '#D97706', bg: 'rgba(217,119,6,0.12)' },
  REVISIONS_REQUESTED: { label: 'שינויים נדרשים',  color: '#D97706', bg: 'rgba(217,119,6,0.12)' },
  LIVE:                { label: 'פעיל',                color: '#059669', bg: 'rgba(5,150,105,0.12)' },
  GOAL_REACHED:        { label: 'יעד הושג',          color: '#059669', bg: 'rgba(5,150,105,0.12)' },
  LEGAL_ACTION:        { label: 'בהליך משפטי',      color: '#1A56DB', bg: 'rgba(26,86,219,0.12)' },
  CLOSED:              { label: 'נסגר',                color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
  REJECTED:            { label: 'נדחה',                color: '#DC2626', bg: 'rgba(220,38,38,0.12)' },
};

export default function MyCasesScreen() {
  const [cases, setCases]     = useState<IncubatorCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await api.getMyCases();
      setCases(r.cases);
    } catch (e: any) {
      setError(e?.message ?? 'שגיאה בטעינה');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <Stack.Screen options={{ headerShown: true, title: 'היוזמות שלי', headerBackTitle: 'חזור' }} />
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
          contentContainerStyle={{ padding: spacing.base, paddingBottom: 160, gap: spacing.base }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
        >
          {/* New case CTA — always visible at the top */}
          <Pressable
            onPress={() => router.push('/cases/new' as any)}
            style={{
              backgroundColor: colors.primary, height: 52, borderRadius: radius.xl,
              alignItems: 'center', justifyContent: 'center', ...shadows.card,
              flexDirection: 'row-reverse', gap: spacing.xs,
            }}
          >
            <Text style={{ ...typography.labelLg, color: '#FFF', fontWeight: '700' }}>
              יזום יוזמת תביעה חדשה
            </Text>
            <Text style={{ color: '#FFF', fontSize: 18 }}>＋</Text>
          </Pressable>

          {cases.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: spacing.xxl }}>
              <Text style={{ fontSize: 48 }}>📋</Text>
              <Text style={{ ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm, textAlign: 'center' }}>
                עדיין לא יזמת תביעה
              </Text>
              <Text style={{ ...typography.bodyBase, color: colors.textTertiary, marginTop: 4, textAlign: 'center' }}>
                ראית פגיעה שחוזרת על עצמה? יזום קבוצת דרישה
              </Text>
            </View>
          ) : (
            cases.map(c => <CaseRow key={c.id} c={c} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

function CaseRow({ c }: { c: IncubatorCase }) {
  const st = STATUS_HE[c.status];
  return (
    <View style={{
      backgroundColor: '#FFF', borderRadius: radius.xl, padding: spacing.base,
      ...shadows.card, borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)', gap: spacing.xs,
    }}>
      <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text style={{ ...typography.h3, color: colors.textPrimary, textAlign: 'right', flex: 1 }}>
          {c.title}
        </Text>
        <View style={{ backgroundColor: st.bg, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 999 }}>
          <Text style={{ ...typography.caption, color: st.color, fontWeight: '700' }}>
            {st.label}
          </Text>
        </View>
      </View>

      <Text style={{ ...typography.bodyBase, color: colors.textSecondary, textAlign: 'right' }}>
        {c.defendantCompany}
      </Text>

      {/* AI score (if analyzed) */}
      {c.powerScore != null && (
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs,
          marginTop: 4,
        }}>
          <Text style={{ fontSize: 14 }}>🤖</Text>
          <Text style={{ ...typography.caption, color: colors.textTertiary }}>
            ציון AI:
          </Text>
          <Text style={{ ...typography.labelSm, color: scoreColor(c.powerScore), fontWeight: '700' }}>
            {c.powerScore.toFixed(1)}/100
          </Text>
        </View>
      )}

      {/* Admin feedback if present */}
      {c.adminNote && (c.status === 'REVISIONS_REQUESTED' || c.status === 'REJECTED') && (
        <View style={{
          backgroundColor: 'rgba(217,119,6,0.08)', borderRadius: radius.md,
          padding: spacing.sm, marginTop: spacing.xs,
        }}>
          <Text style={{ ...typography.caption, color: '#92400E', textAlign: 'right', fontWeight: '700' }}>
            הערת צוות:
          </Text>
          <Text style={{ ...typography.bodyBase, color: '#92400E', textAlign: 'right', marginTop: 2 }}>
            {c.adminNote}
          </Text>
        </View>
      )}

      <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <Text style={{ ...typography.caption, color: colors.textTertiary }}>
          {c._count?.members ?? 0} חברים · {c._count?.evidence ?? 0} ראיות
        </Text>
        <Text style={{ ...typography.caption, color: colors.textTertiary }}>
          {new Date(c.createdAt).toLocaleDateString('he-IL')}
        </Text>
      </View>
    </View>
  );
}

function scoreColor(score: number): string {
  if (score >= 70) return '#059669';
  if (score >= 50) return '#D97706';
  return '#DC2626';
}
