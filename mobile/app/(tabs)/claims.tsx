// ─────────────────────────────────────────────────────────────────────────────
//  app/(tabs)/claims.tsx — "תביעות" — Claim tracking with progress steps
//  Matches Figma design: filter tabs, progress bars, step timeline, action btns
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator,
  StatusBar, Platform,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { colors, typography, spacing, radius, shadows, brandColor, BRAND_COLORS } from '@/theme';
import { Button, Card } from '@/components/ui';
import * as api from '@/services/api';
import type { UserClaim, SettlementCategory } from '@/services/api';

const CATEGORY_INFO = api.CATEGORY_INFO;

const FILTERS = [
  { key: 'ALL',      label: 'הכל' },
  { key: 'REVIEW',   label: 'בבדיקה' },
  { key: 'APPROVED', label: 'אושר' },
  { key: 'PAID',     label: 'שולם' },
] as const;
type FilterKey = typeof FILTERS[number]['key'];

// ── Progress Steps Logic ────────────────────────────────────────────────────

interface ProgressStep {
  label: string;
  done: boolean;
}

function getProgressSteps(claim: UserClaim): ProgressStep[] {
  const lawsuit = claim.lawsuit;
  const status = (lawsuit as any).distributionStatus;
  const hasPayout = !!(lawsuit as any).estimatedPayout;

  if (status === 'distributing' || status === 'closed') {
    return [
      { label: 'הבקשה הוגשה בהצלחה', done: true },
      { label: 'מסמכים תחת בדיקה',  done: true },
      { label: hasPayout ? `התביעה אושרה לפיצוי ${(lawsuit as any).estimatedPayout}` : 'התביעה אושרה', done: status === 'closed' || hasPayout },
      { label: 'ממתין לתשלום',        done: status === 'closed' },
    ];
  }

  // Default: in review
  return [
    { label: 'הבקשה הוגשה בהצלחה', done: true },
    { label: 'מסמכים תחת בדיקה',  done: claim.action === 'JOINED' },
    { label: 'ממתין לאישות',        done: false },
  ];
}

function getProgressPercent(steps: ProgressStep[]) {
  const done = steps.filter(s => s.done).length;
  return Math.round((done / steps.length) * 100);
}

function getClaimStatus(claim: UserClaim): { label: string; color: string; bg: string } {
  const status = (claim.lawsuit as any).distributionStatus;
  if (status === 'closed')       return { label: 'שולם',    color: '#059669', bg: '#D1FAE5' };
  if (status === 'distributing') return { label: 'אושר',    color: '#2563EB', bg: '#DBEAFE' };
  return                                 { label: 'בבדיקה',  color: '#D97706', bg: '#FEF3C7' };
}

// ── Claim Card — Matching Figma spec ─────────────────────────────────────────

function ClaimCard({ claim, index }: { claim: UserClaim; index: number }) {
  const lawsuit = claim.lawsuit;
  const catInfo = (lawsuit as any).category ? CATEGORY_INFO[(lawsuit as any).category as SettlementCategory] : null;
  const steps = getProgressSteps(claim);
  const percent = getProgressPercent(steps);
  const status = getClaimStatus(claim);

  // Brand color — prefer centralized map, fall back to primary
  const matchedBrand = Object.keys(BRAND_COLORS).find(b => lawsuit.defendantName.includes(b));
  const bgColor = matchedBrand ? BRAND_COLORS[matchedBrand] : brandColor(lawsuit.defendantName);

  const isApproved = status.label === 'אושר' || status.label === 'שולם';
  const openDetail = () =>
    router.push({ pathname: '/settlement/[id]', params: { id: lawsuit.id } });

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index * 50, 300)).duration(260)}>
      <Card style={{ marginHorizontal: spacing.base, marginBottom: spacing.md }}>
        {/* Header: Logo + Title + Menu */}
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center',
          gap: spacing.sm, marginBottom: spacing.sm,
        }}>
          <View style={{
            width: 44, height: 44, borderRadius: 13,
            backgroundColor: bgColor,
            alignItems: 'center', justifyContent: 'center',
          }}>
            {catInfo ? (
              <Text style={{ fontSize: 20 }}>{catInfo.icon}</Text>
            ) : (
              <Text style={{ fontSize: 18, color: '#FFF', fontWeight: '700' }}>
                {lawsuit.defendantName.charAt(0)}
              </Text>
            )}
          </View>

          <View style={{ flex: 1 }}>
            <Text style={{ ...typography.h3, color: colors.textPrimary, textAlign: 'right' }} numberOfLines={1}>
              {lawsuit.defendantName}
            </Text>
          </View>

          <Pressable style={{ padding: spacing.xs }}>
            <Text style={{ fontSize: 18, color: colors.textTertiary }}>⋯</Text>
          </Pressable>
        </View>

        {/* Status label */}
        <Text style={{
          ...typography.labelSm, color: status.color,
          textAlign: 'right', fontWeight: '600', marginBottom: spacing.sm,
        }}>
          {status.label}
        </Text>

        {/* Progress bar */}
        <View style={{
          height: 6, borderRadius: 3,
          backgroundColor: 'rgba(0,0,0,0.06)',
          marginBottom: spacing.md,
          overflow: 'hidden',
        }}>
          <View style={{
            height: '100%', borderRadius: 3,
            backgroundColor: status.color,
            width: `${percent}%`,
          }} />
        </View>

        {/* Step timeline */}
        <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
          {steps.map((step, i) => (
            <View key={i} style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm,
            }}>
              <View style={{
                width: 22, height: 22, borderRadius: 11,
                backgroundColor: step.done ? '#D1FAE5' : 'rgba(0,0,0,0.04)',
                alignItems: 'center', justifyContent: 'center',
                borderWidth: step.done ? 0 : 1,
                borderColor: 'rgba(0,0,0,0.10)',
              }}>
                {step.done ? (
                  <Text style={{ fontSize: 12, color: '#059669' }}>✓</Text>
                ) : (
                  <Text style={{ fontSize: 10, color: colors.textDisabled }}>○</Text>
                )}
              </View>
              <Text style={{
                ...typography.bodySm,
                color: step.done ? colors.textPrimary : colors.textTertiary,
                textAlign: 'right', flex: 1,
              }}>
                {step.label}
              </Text>
            </View>
          ))}
        </View>

        {/* Action buttons row */}
        <View style={{ flexDirection: 'row-reverse', gap: spacing.sm }}>
          <Button
            label="פרטים"
            variant="secondary"
            size="sm"
            onPress={openDetail}
            style={{ flex: 1 }}
          />
          <Button
            label={isApproved ? 'קבל' : 'טפל'}
            variant={isApproved ? 'success' : 'primary'}
            size="sm"
            onPress={openDetail}
            style={{ flex: 1 }}
          />
        </View>
      </Card>
    </Animated.View>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function ClaimsScreen() {
  const [filter, setFilter]       = useState<FilterKey>('ALL');
  const [claims, setClaims]       = useState<UserClaim[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const action = filter === 'ALL' ? undefined : 'JOINED';
      const data = await api.getUserClaims(action);
      setClaims(data.claims);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => { setLoading(true); fetchData(); }, [fetchData]);
  const onRefresh = useCallback(() => { setRefreshing(true); fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgPage, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <StatusBar barStyle="dark-content" />

      <FlatList
        data={claims}
        keyExtractor={item => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <>
            {/* Header */}
            <View style={{
              paddingTop: Platform.OS === 'ios' ? 60 : 40,
              paddingHorizontal: spacing.base,
              paddingBottom: spacing.base,
              backgroundColor: colors.bgPage,
            }}>
              <Text style={{ ...typography.displayMd, color: colors.textPrimary, textAlign: 'right' }}>
                תביעות
              </Text>
            </View>

            {/* Filter tabs */}
            <View style={{
              flexDirection: 'row-reverse', gap: spacing.xs,
              paddingHorizontal: spacing.base, marginBottom: spacing.lg,
            }}>
              {FILTERS.map(f => (
                <Pressable
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={{
                    paddingHorizontal: spacing.base, paddingVertical: 10,
                    borderRadius: radius.pill,
                    backgroundColor: filter === f.key ? colors.primary : '#FFF',
                    borderWidth: 1,
                    borderColor: filter === f.key ? colors.primary : 'rgba(0,0,0,0.08)',
                    ...shadows.glass,
                  }}
                >
                  <Text style={{
                    ...typography.labelSm, fontWeight: '600',
                    color: filter === f.key ? '#FFF' : colors.textSecondary,
                  }}>
                    {f.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl, marginTop: spacing.xxxl }}>
            <Text style={{ fontSize: 48, marginBottom: spacing.base }}>📄</Text>
            <Text style={{ ...typography.h2, color: colors.textTertiary, textAlign: 'center' }}>
              עדיין אין תביעות
            </Text>
            <Text style={{ ...typography.bodyBase, color: colors.textDisabled, textAlign: 'center', marginTop: spacing.sm }}>
              לחץ על "בדיקת זכאות" בהסדר שמעניין אותך
            </Text>
            <View style={{ marginTop: spacing.xl }}>
              <Button
                label="לרשימת ההסדרים"
                variant="primary"
                size="md"
                onPress={() => router.push('/(tabs)')}
              />
            </View>
          </View>
        }
        renderItem={({ item, index }) => <ClaimCard claim={item} index={index} />}
      />
    </View>
  );
}
