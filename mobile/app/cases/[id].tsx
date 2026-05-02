// ─────────────────────────────────────────────────────────────────────────────
//  app/cases/[id].tsx — Public incubator case detail + Join CTA + referral share
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, Alert,
  StatusBar, Share, Platform,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { colors, typography, spacing, radius } from '@/theme';
import * as api from '@/services/api';

export default function CaseDetailScreen() {
  const { id, ref } = useLocalSearchParams<{ id: string; ref?: string }>();
  const [kase, setKase]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined]   = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await api.getCase(id);
      setKase(data.case);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const onJoin = async () => {
    if (!id || joining) return;
    setJoining(true);
    try {
      const r = await api.joinCase(id, ref ? { referralToken: String(ref) } : {});
      setJoined(true);
      Alert.alert(
        r.alreadyMember ? 'כבר חברת ביוזמה' : 'הצטרפת ליוזמה! 🎉',
        r.alreadyMember ? undefined : 'תקבל עדכונים כשהיוזמה תתקדם',
      );
    } catch (e: any) {
      Alert.alert('לא ניתן להצטרף', e?.message ?? 'שגיאה');
    } finally {
      setJoining(false);
    }
  };

  const onShare = async () => {
    if (!id) return;
    try {
      const link = await api.createReferralLink(id);
      const shareUrl = link.url ?? `fairtogether://cases/${id}?ref=${link.linkToken}`;
      await Share.share({
        message: `${kase?.title ?? 'יוזמת תביעה ייצוגית'}\n${shareUrl}`,
      });
    } catch (e: any) {
      if (e?.message?.includes('NOT_A_MEMBER')) {
        Alert.alert('הצטרפי קודם ליוזמה כדי לשתף');
      } else {
        Alert.alert('לא ניתן לשתף', e?.message ?? 'שגיאה');
      }
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPage }}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }
  if (error || !kase) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPage, padding: spacing.xl }}>
        <Text style={{ ...typography.bodyMd, color: colors.danger, textAlign: 'center' }}>
          {error ?? 'יוזמה לא נמצאה'}
        </Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: spacing.lg }}>
          <Text style={{ ...typography.button, color: colors.primary }}>חזרה</Text>
        </Pressable>
      </View>
    );
  }

  const score   = kase.powerScore != null ? Math.round(kase.powerScore) : null;
  const members = kase._count?.members ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <Stack.Screen options={{ title: 'יוזמת תביעה', headerBackTitle: 'חזרה' }} />
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
      >
        <Text style={{ ...typography.displayMd, color: colors.textPrimary, textAlign: 'right' }}>
          {kase.title}
        </Text>
        <Text style={{
          ...typography.bodyMd, color: colors.textSecondary,
          textAlign: 'right', marginTop: spacing.xs,
        }}>
          נגד: {kase.defendantCompany}
        </Text>

        <View style={{
          flexDirection: 'row-reverse', gap: spacing.sm,
          marginTop: spacing.base, flexWrap: 'wrap',
        }}>
          {score != null && (
            <Pill label={`ציון עוצמה ${score}/100`} />
          )}
          <Pill label={`${members} חברים`} />
          <Pill label={String(kase.legalClaimType)} />
        </View>

        <SectionTitle>תיאור</SectionTitle>
        <Text style={{
          ...typography.bodyMd, color: colors.textPrimary,
          textAlign: 'right', lineHeight: 22,
        }}>
          {kase.narrative}
        </Text>

        {kase.aiAnalysis && (
          <>
            <SectionTitle>ניתוח AI</SectionTitle>
            <Text style={{
              ...typography.bodyMd, color: colors.textPrimary,
              textAlign: 'right', lineHeight: 22,
            }}>
              {(kase.aiAnalysis as any)?.summary ?? JSON.stringify(kase.aiAnalysis).slice(0, 500)}
            </Text>
          </>
        )}
      </ScrollView>

      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        padding: spacing.base,
        paddingBottom: Platform.OS === 'ios' ? 28 : spacing.base,
        backgroundColor: colors.bgWhite,
        flexDirection: 'row-reverse', gap: spacing.sm,
      }}>
        <Pressable
          onPress={onJoin}
          disabled={joining || joined}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: 14,
            borderRadius: radius.md,
            backgroundColor: joined ? colors.bgGreenBadge : colors.primary,
            alignItems: 'center',
            opacity: pressed || joining ? 0.7 : 1,
          })}
        >
          {joining ? (
            <ActivityIndicator size="small" color={colors.bgWhite} />
          ) : (
            <Text style={{
              ...typography.button,
              color: joined ? colors.textPrimary : colors.bgWhite,
            }}>
              {joined ? 'הצטרפת ✓' : 'הצטרפו ליוזמה'}
            </Text>
          )}
        </Pressable>
        {joined && (
          <Pressable
            onPress={onShare}
            style={({ pressed }) => ({
              paddingVertical: 14,
              paddingHorizontal: spacing.lg,
              borderRadius: radius.md,
              backgroundColor: colors.bgBlue,
              alignItems: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ ...typography.button, color: colors.primary }}>שיתוף</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <View style={{
      paddingVertical: 4, paddingHorizontal: spacing.sm,
      borderRadius: radius.pill, backgroundColor: colors.bgBlue,
    }}>
      <Text style={{ ...typography.labelSm, color: colors.primary }}>{label}</Text>
    </View>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{
      ...typography.h2, color: colors.textPrimary,
      textAlign: 'right', marginTop: spacing.xl, marginBottom: spacing.sm,
    }}>
      {children}
    </Text>
  );
}
