// ─────────────────────────────────────────────────────────────────────────────
//  app/r/[token].tsx — Referral landing page
//  Resolves a shared link token to its IncubatorCase, records the click, then
//  redirects to the case detail screen with ?ref=<token> so joinCase can
//  credit the inviter. Deep link: fairtogether://r/<token>
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, StatusBar } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { colors, typography, spacing } from '@/theme';
import { recordReferralClick } from '@/services/api';

export default function ReferralLandingScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError('קישור לא תקין'); return; }
    (async () => {
      try {
        // No auth required — click attribution only. IP-hashed on the server.
        const hit = await recordReferralClick(String(token));
        router.replace({
          pathname: '/cases/[id]' as any,
          params:   { id: hit.caseId, ref: String(token) },
        });
      } catch (e: any) {
        setError(e?.message ?? 'לא ניתן לפתוח את הקישור');
      }
    })();
  }, [token]);

  return (
    <View style={{
      flex: 1, backgroundColor: colors.bgPage,
      justifyContent: 'center', alignItems: 'center',
      paddingHorizontal: spacing.xl,
    }}>
      <StatusBar barStyle="dark-content" />
      {!error ? (
        <>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={{
            ...typography.bodyMd, color: colors.textTertiary,
            marginTop: spacing.base, textAlign: 'center',
          }}>
            טוען קישור…
          </Text>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 44, marginBottom: spacing.sm }}>⚠️</Text>
          <Text style={{
            ...typography.bodyMd, color: colors.danger,
            textAlign: 'center', marginBottom: spacing.lg,
          }}>
            {error}
          </Text>
          <Pressable onPress={() => router.replace('/(tabs)')}>
            <Text style={{ ...typography.button, color: colors.primary }}>חזרה למסך הבית</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
