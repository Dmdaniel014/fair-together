// ─────────────────────────────────────────────────────────────────────────────
//  app/legal/index.tsx — Legal Consultation (ייעוץ משפטי) thread list.
//  User can: start a new GENERAL chat, pick an existing thread, or open a
//  STRENGTHEN thread for one of their weak cases.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator,
  StatusBar, RefreshControl, Alert,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { colors, typography, spacing, radius, shadows } from '@/theme';
import * as api from '@/services/api';
import type { LegalThread } from '@/services/api';

const MODE_HE: Record<LegalThread['mode'], { label: string; icon: string; color: string }> = {
  STRENGTHEN: { label: 'חיזוק יוזמה', icon: '💪', color: '#1A56DB' },
  GENERAL:    { label: 'שאלה כללית',  icon: '💬', color: '#6B7280' },
};

const STATUS_HE: Record<LegalThread['status'], { label: string; color: string } | null> = {
  ACTIVE:              null, // don't show a badge for active
  RESOLVED:            { label: 'נפתר',                color: '#059669' },
  ESCALATED_TO_LAWYER: { label: 'הועבר לעורך דין',   color: '#1A56DB' },
  ARCHIVED:            { label: 'בארכיון',             color: '#6B7280' },
};

export default function LegalThreadsScreen() {
  const [threads, setThreads] = useState<LegalThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.listLegalThreads();
      setThreads(r.threads);
    } catch (e: any) {
      Alert.alert('שגיאה', e?.message ?? 'טעינה נכשלה');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // "שיחה חדשה" creates a GENERAL thread and jumps straight into it.
  // Title is auto-generated after the first exchange server-side.
  async function startGeneralChat() {
    if (creating) return;
    setCreating(true);
    try {
      const r = await api.createLegalThread({ mode: 'GENERAL' });
      router.push(`/legal/${r.thread.id}` as any);
    } catch (e: any) {
      Alert.alert('שגיאה', e?.message ?? 'לא ניתן היה לפתוח שיחה');
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <Stack.Screen options={{ headerShown: true, title: 'ייעוץ משפטי', headerBackTitle: 'חזור' }} />
      <StatusBar barStyle="dark-content" />

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.base, paddingBottom: 160, gap: spacing.base }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {/* Hero card — explains what this is + primary CTA */}
          <View style={{
            backgroundColor: '#FFF', borderRadius: radius.xl, padding: spacing.base,
            ...shadows.card, borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)', gap: spacing.sm,
          }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm }}>
              <Text style={{ fontSize: 26 }}>⚖️</Text>
              <Text style={{ ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'right' }}>
                יועץ משפטי-צרכני
              </Text>
            </View>
            <Text style={{ ...typography.bodyBase, color: colors.textSecondary, textAlign: 'right' }}>
              שאל שאלות על זכויותיך, קבל הכוונה לעילות משפטיות, וחזק יוזמות תביעה שהגשת — הכל בשיחה עם AI.
            </Text>
            <Pressable
              onPress={startGeneralChat}
              disabled={creating}
              style={{
                backgroundColor: colors.primary, height: 48, borderRadius: radius.lg,
                alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs,
                opacity: creating ? 0.6 : 1,
                flexDirection: 'row-reverse', gap: spacing.xs,
              }}
            >
              {creating
                ? <ActivityIndicator color="#FFF" />
                : <>
                    <Text style={{ ...typography.labelLg, color: '#FFF', fontWeight: '700' }}>התחל שיחה חדשה</Text>
                    <Text style={{ color: '#FFF', fontSize: 18 }}>💬</Text>
                  </>}
            </Pressable>
          </View>

          {/* History */}
          {threads.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: spacing.xxl }}>
              <Text style={{ fontSize: 48 }}>📚</Text>
              <Text style={{ ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm, textAlign: 'center' }}>
                אין לך שיחות קודמות
              </Text>
              <Text style={{ ...typography.bodyBase, color: colors.textTertiary, marginTop: 4, textAlign: 'center' }}>
                פתח שיחה חדשה כדי לשאול שאלה משפטית
              </Text>
            </View>
          ) : (
            <>
              <Text style={{ ...typography.labelSm, color: colors.textTertiary,
                textAlign: 'right', marginBottom: -spacing.xs, paddingHorizontal: spacing.xs }}>
                שיחות קודמות
              </Text>
              {threads.map(t => <ThreadRow key={t.id} t={t} />)}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function ThreadRow({ t }: { t: LegalThread }) {
  const mode   = MODE_HE[t.mode];
  const status = STATUS_HE[t.status];
  const msgCount = t._count?.messages ?? 0;

  return (
    <Pressable
      onPress={() => router.push(`/legal/${t.id}` as any)}
      style={{
        backgroundColor: '#FFF', borderRadius: radius.xl, padding: spacing.base,
        ...shadows.card, borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)', gap: spacing.xs,
      }}
    >
      <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
        <View style={{ flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs }}>
          <Text style={{ fontSize: 18 }}>{mode.icon}</Text>
          <Text
            style={{ ...typography.labelLg, color: colors.textPrimary, textAlign: 'right', flex: 1 }}
            numberOfLines={1}
          >
            {t.title ?? 'שיחה ללא כותרת'}
          </Text>
        </View>
        {status && (
          <View style={{ backgroundColor: `${status.color}22`, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 999 }}>
            <Text style={{ ...typography.caption, color: status.color, fontWeight: '700' }}>
              {status.label}
            </Text>
          </View>
        )}
      </View>

      {/* Case linkage hint for STRENGTHEN threads */}
      {t.mode === 'STRENGTHEN' && t.case && (
        <Text style={{ ...typography.caption, color: colors.textTertiary, textAlign: 'right' }}>
          קשור ליוזמה: {t.case.title}
          {t.case.powerScore != null && ` · ציון ${t.case.powerScore.toFixed(0)}`}
        </Text>
      )}

      <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <Text style={{ ...typography.caption, color: colors.textTertiary }}>
          {mode.label} · {msgCount} הודעות
        </Text>
        <Text style={{ ...typography.caption, color: colors.textTertiary }}>
          {new Date(t.updatedAt).toLocaleDateString('he-IL')}
        </Text>
      </View>
    </Pressable>
  );
}
