// ─────────────────────────────────────────────────────────────────────────────
//  app/(tabs)/profile.tsx — Profile screen matching Figma design
//  Avatar, premium CTA, sections: payments, settings, preferences
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StatusBar, ScrollView, Alert, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { colors, typography, spacing, radius, shadows, skyGradient } from '@/theme';
import { Badge } from '@/components/ui';
import * as api from '@/services/api';

function showComingSoon() {
  Alert.alert('בקרוב!', 'פיצ׳ר זה יהיה זמין בגרסה הבאה', [{ text: 'הבנתי' }]);
}

function initialFor(me: api.Me | null): string {
  const src = me?.displayName || me?.email || me?.phone || 'דניאל';
  const first = src.trim().charAt(0);
  return first || '?';
}

type SectionRow = { icon: string; label: string; onPress: () => void };
type Section = { title: string; rows: SectionRow[] };

export default function ProfileScreen() {
  const [claimStats, setClaimStats] = useState({ JOINED: 0, SAVED: 0, DISMISSED: 0 });
  const [me, setMe] = useState<api.Me | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);

  useEffect(() => {
    api.getUserClaimStats().then(setClaimStats).catch(() => {});
    api.getMe().then(setMe).catch(() => {});
  }, []);

  // Admins see a badge with the pending-review count — refresh when screen loads.
  useEffect(() => {
    if (me?.role !== 'ADMIN') return;
    api.getPendingCases().then(r => setPendingCount(r.total)).catch(() => {});
  }, [me?.role]);

  async function handleLogout() {
    await api.clearAuth();
    router.replace('/(auth)');
  }

  const sections: Section[] = [
    {
      title: 'יוזמות תביעה',
      rows: [
        { icon: '⚖️', label: 'היוזמות שלי',           onPress: () => router.push('/cases' as any) },
        { icon: '➕', label: 'יזום יוזמת תביעה חדשה', onPress: () => router.push('/cases/new' as any) },
      ],
    },
    {
      title: 'ייעוץ משפטי',
      rows: [
        { icon: '💬', label: 'ייעוץ משפטי AI', onPress: () => router.push('/legal' as any) },
      ],
    },
    {
      title: 'תשלומים וארנק',
      rows: [
        { icon: '💳', label: 'אפשרויות תשלום',   onPress: showComingSoon },
        { icon: '📋', label: 'היסטוריית תשלומים', onPress: showComingSoon },
      ],
    },
    {
      title: 'הגדרות חשבון',
      rows: [
        { icon: '👤', label: 'פרטי חשבון',     onPress: showComingSoon },
        { icon: '🔒', label: 'התחברות ואבטחה', onPress: showComingSoon },
      ],
    },
    {
      title: 'העדפות והתראות',
      rows: [
        { icon: '⚙️', label: 'העדפות מערכת', onPress: showComingSoon },
      ],
    },
  ];

  const adminSection: Section | null = me?.role === 'ADMIN' ? {
    title: 'ניהול קייסים (אדמין)',
    rows: [
      {
        icon:  '🗂️',
        label: pendingCount > 0 ? `קייסים ממתינים לאישור (${pendingCount})` : 'קייסים ממתינים לאישור',
        onPress: () => router.push('/admin/pending' as any),
      },
    ],
  } : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <StatusBar barStyle="dark-content" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

        {/* ── Sky gradient header with avatar ─────────────────── */}
        <LinearGradient
          colors={skyGradient.colors as any}
          locations={skyGradient.locations as any}
          style={{
            paddingTop: Platform.OS === 'ios' ? 60 : 40,
            paddingBottom: spacing.xxl,
            alignItems: 'center',
          }}
        >
          {/* Avatar with pencil overlay */}
          <View style={{ marginBottom: spacing.sm }}>
            <View style={{
              width: 84, height: 84, borderRadius: 42,
              backgroundColor: colors.bgBlue,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 3, borderColor: '#FFFFFF',
              ...shadows.cardRaised,
              overflow: 'hidden',
            }}>
              <LinearGradient
                colors={['#F59E0B', '#EF4444']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              />
              <Text style={{ fontSize: 34, color: '#FFF', fontWeight: '700' }}>
                {initialFor(me)}
              </Text>
            </View>
            <Pressable style={{
              position: 'absolute',
              bottom: -2, left: -2,
              width: 28, height: 28, borderRadius: 14,
              backgroundColor: colors.primary,
              borderWidth: 2, borderColor: '#FFFFFF',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 12, color: '#FFFFFF' }}>✎</Text>
            </Pressable>
          </View>

          <Text style={{ ...typography.displayMd, color: colors.textPrimary }}>
            {me?.displayName || 'דניאל'}
          </Text>
          <Text style={{
            fontFamily: 'Heebo_500Medium',
            fontSize: 12,
            color: colors.textSecondary,
            marginTop: 2,
            letterSpacing: 0.5,
          }}>
            {me?.phone || '054-1234567'}
          </Text>
        </LinearGradient>

        <View style={{ paddingHorizontal: spacing.base, gap: spacing.base, marginTop: -spacing.base }}>

          {/* ── Premium CTA card ────────────────────────────────── */}
          <View style={{
            backgroundColor: '#FFF', borderRadius: radius.xl,
            overflow: 'hidden', ...shadows.card,
            borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)',
          }}>
            {/* Blue top accent */}
            <LinearGradient
              colors={['#1A56DB', '#3B82F6']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={{ height: 4 }}
            />
            <View style={{
              flexDirection: 'row', alignItems: 'center', padding: spacing.base,
            }}>
              {/* Crown icon */}
              <View style={{
                width: 48, height: 48, borderRadius: 14,
                backgroundColor: 'rgba(26,86,219,0.08)',
                alignItems: 'center', justifyContent: 'center',
                marginRight: spacing.md,
              }}>
                <Text style={{ fontSize: 24 }}>👑</Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.h3, color: colors.textPrimary, textAlign: 'right' }}>
                  שדרג למנוי פרימיום
                </Text>
                <View style={{
                  flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm,
                  marginTop: 6,
                }}>
                  <Badge label="שדרג" tone="success" />
                  <Text style={{
                    fontFamily: 'Heebo_500Medium',
                    fontSize: 12,
                    color: colors.textSecondary,
                    letterSpacing: 0.3,
                  }}>
                    12.90₪/חודש
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* ── Settings sections ────────────────────────────────── */}
          {(adminSection ? [adminSection, ...sections] : sections).map(section => {
            // Single-row sections: make the title also fire the row's onPress
            // so the whole "block" is tappable — users tap the title text
            // expecting it to be the button.
            const titleOnPress = section.rows.length === 1 ? section.rows[0].onPress : undefined;
            return (
              <View key={section.title}>
                <Pressable
                  onPress={titleOnPress}
                  disabled={!titleOnPress}
                  hitSlop={titleOnPress ? 8 : 0}
                >
                  <Text style={{
                    ...typography.labelSm, color: colors.textTertiary,
                    textAlign: 'right', marginBottom: spacing.sm, paddingHorizontal: spacing.xs,
                  }}>
                    {section.title}
                  </Text>
                </Pressable>
                <View style={{
                  backgroundColor: '#FFF', borderRadius: radius.xl,
                  ...shadows.card, borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)',
                  overflow: 'hidden',
                }}>
                  {section.rows.map((row, i) => (
                    <Pressable
                      key={row.label}
                      onPress={row.onPress}
                      style={{
                        flexDirection: 'row', alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingHorizontal: spacing.base, paddingVertical: 15,
                        borderTopWidth: i > 0 ? 1 : 0,
                        borderTopColor: 'rgba(0,0,0,0.04)',
                      }}
                    >
                      {/* Chevron left */}
                      <Text style={{ fontSize: 14, color: colors.textDisabled }}>‹</Text>

                      {/* Icon + label — right aligned */}
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                        <Text style={{ fontSize: 18 }}>{row.icon}</Text>
                        <Text style={{ ...typography.labelLg, color: colors.textPrimary }}>{row.label}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}

          {/* Logout */}
          <Pressable
            onPress={handleLogout}
            style={{
              height: 48, borderRadius: radius.xl,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: '#FFF',
              borderWidth: 1, borderColor: colors.danger,
              ...shadows.glass,
            }}
          >
            <Text style={{ ...typography.labelLg, color: colors.danger, fontWeight: '600' }}>
              התנתקות
            </Text>
          </Pressable>

          {/* Version */}
          <Text style={{ ...typography.caption, color: colors.textDisabled, textAlign: 'center' }}>
            גרסה 1.0.0
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
