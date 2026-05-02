// ─────────────────────────────────────────────────────────────────────────────
//  app/(tabs)/index.tsx — Home screen matching Figma design spec
//  Header: greeting + search → section title → settlement cards
//  Card: logo circle, badges, summary, payout range + date, CTA
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator,
  StatusBar, Platform, TextInput, ScrollView,
} from 'react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { colors, typography, spacing, radius, shadows, skyGradient, formatDate, brandColor, BRAND_COLORS } from '@/theme';
import { Button, Badge, Card } from '@/components/ui';
import * as api from '@/services/api';
import type { Settlement, SettlementCategory } from '@/services/api';

const CATEGORY_INFO = api.CATEGORY_INFO;
type CategoryFilter = SettlementCategory | 'ALL';

const CATEGORY_FILTERS: { key: CategoryFilter; label: string; icon: string }[] = [
  { key: 'ALL',       label: 'הכל',       icon: '💰' },
  { key: 'telecom',   label: 'תקשורת',    icon: '📱' },
  { key: 'banks',     label: 'בנקים',     icon: '🏦' },
  { key: 'retail',    label: 'קמעונאות',  icon: '🛒' },
  { key: 'insurance', label: 'ביטוח',     icon: '🛡️' },
  { key: 'food',      label: 'מזון',      icon: '🍎' },
  { key: 'tech',      label: 'טכנולוגיה', icon: '💻' },
  { key: 'health',    label: 'בריאות',    icon: '🏥' },
  { key: 'transport', label: 'תחבורה',    icon: '✈️' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(d: string | null) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
}

function isEnriched(s: Settlement) {
  return !!s.estimatedPayout || (Array.isArray(s.claimGuideSteps) && (s.claimGuideSteps as string[]).length > 0);
}

function sortSettlements(list: Settlement[]) {
  return [...list].sort((a, b) => {
    const dA = daysUntil(a.claimDeadline);
    const dB = daysUntil(b.claimDeadline);
    if (dA !== null && dA >= 0 && (dB === null || dB < 0)) return -1;
    if (dB !== null && dB >= 0 && (dA === null || dA < 0)) return 1;
    if (dA !== null && dB !== null && dA >= 0 && dB >= 0) return dA - dB;
    return 0;
  });
}

function statusBadge(status: string | null): { label: string; color: string } {
  if (status === 'open')         return { label: 'משלם',    color: '#059669' };
  if (status === 'distributing') return { label: 'בחלוקה',  color: '#2563EB' };
  if (status === 'closed')       return { label: 'סגור',    color: '#94A3B8' };
  return                                { label: 'פעיל',    color: '#D97706' };
}

// ── Company Logo Circle ─────────────────────────────────────────────────────

function CompanyLogo({ name, category }: { name: string; category: string | null }) {
  const catInfo = category ? CATEGORY_INFO[category as SettlementCategory] : null;

  // Use centralized brand color map with substring matching as a fallback
  const matchedBrand = Object.keys(BRAND_COLORS).find(b => name.includes(b));
  const bgColor = matchedBrand ? BRAND_COLORS[matchedBrand] : brandColor(name);

  return (
    <View style={{
      width: 48, height: 48, borderRadius: 14,
      backgroundColor: bgColor,
      alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {catInfo ? (
        <Text style={{ fontSize: 22 }}>{catInfo.icon}</Text>
      ) : (
        <Text style={{ fontSize: 20, color: '#FFF', fontWeight: '700' }}>
          {name.charAt(0)}
        </Text>
      )}
    </View>
  );
}

// ── Settlement Card — matching Figma spec ────────────────────────────────────

function SettlementCard({ settlement, index }: { settlement: Settlement; index: number }) {
  const catInfo = settlement.category ? CATEGORY_INFO[settlement.category as SettlementCategory] : null;
  const days = daysUntil(settlement.claimDeadline);
  const enriched = isEnriched(settlement);
  const status = statusBadge(settlement.distributionStatus);

  // Payout text
  const payoutText = settlement.estimatedPayout
    ?? (settlement.payoutMinILS && settlement.payoutMaxILS
      ? `₪ ${settlement.payoutMinILS} - ${settlement.payoutMaxILS}`
      : null);

  const openSettlement = () =>
    router.push({ pathname: '/settlement/[id]', params: { id: settlement.id } });

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index * 55, 350)).duration(280)}>
      <Card
        onPress={openSettlement}
        style={{ marginHorizontal: spacing.base, marginBottom: spacing.md }}
      >
        {/* Row 1: Logo + Title + Badges */}
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'flex-start',
          gap: spacing.sm, marginBottom: spacing.md,
        }}>
          <CompanyLogo name={settlement.defendantName} category={settlement.category} />

          <View style={{ flex: 1, gap: 6 }}>
            <Text style={{
              ...typography.h2, color: colors.textPrimary,
              textAlign: 'right', lineHeight: 26,
            }} numberOfLines={2}>
              {settlement.defendantName}
            </Text>

            {/* Badges row */}
            <View style={{ flexDirection: 'row-reverse', gap: spacing.xs, flexWrap: 'wrap' }}>
              {enriched && <Badge label="התאמה חזקה" tone="success" />}
              <Badge label={status.label} color={status.color} />
            </View>
          </View>
        </View>

        {/* Summary */}
        {settlement.summary && (
          <Text style={{
            ...typography.bodyBase, color: colors.textSecondary,
            textAlign: 'right', lineHeight: 22,
            marginBottom: spacing.md,
          }} numberOfLines={3}>
            {settlement.summary}
          </Text>
        )}

        {/* Payout range + Deadline date row */}
        {(payoutText || (days !== null && days >= 0)) && (
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: spacing.md,
          }}>
            {payoutText ? (
              <Text style={{
                ...typography.h2, color: colors.success, fontWeight: '700',
                fontSize: 17,
              }}>
                {payoutText}
              </Text>
            ) : <View />}

            {settlement.claimDeadline && days !== null && days >= 0 ? (
              <Text style={{
                ...typography.labelMd, color: colors.textTertiary,
                fontWeight: '600',
              }}>
                {formatDate(settlement.claimDeadline)}
              </Text>
            ) : <View />}
          </View>
        )}

        {/* CTA */}
        <Button
          label="בדיקת זכאות"
          variant="primary"
          size="md"
          fullWidth
          onPress={openSettlement}
        />
      </Card>
    </Animated.View>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [catFilter, setCatFilter]   = useState<CategoryFilter>('ALL');
  const [search, setSearch]         = useState('');
  const [showAll, setShowAll]       = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const data = await api.getSettlements();
      setSettlements(data.settlements ?? []);
    } catch {
      try {
        const data = await api.getLawsuits();
        const mapped = data.lawsuits
          .filter(l => ['SETTLEMENT_APPROVED', 'SETTLEMENT'].includes(l.status))
          .map(l => ({
            ...l,
            category: null, claimFormUrl: null, payoutMethod: null,
            distributionStatus: 'open', claimGuideSteps: null,
            claimGuideHe: null, estimatedPayout: null, isSettlement: true,
          } as Settlement));
        setSettlements(mapped);
      } catch {
        setError('לא ניתן להתחבר לשרת');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  const onRefresh = useCallback(() => { setRefreshing(true); fetchData(); }, [fetchData]);

  // Apply category filter
  const catFiltered = useMemo(() => {
    let list = settlements;
    if (catFilter !== 'ALL') list = list.filter(s => s.category === catFilter);
    return list;
  }, [settlements, catFilter]);

  // Apply search filter
  const searchFiltered = useMemo(() => {
    if (!search.trim()) return catFiltered;
    const q = search.trim().toLowerCase();
    return catFiltered.filter(s =>
      s.defendantName.toLowerCase().includes(q) ||
      (s.summary?.toLowerCase().includes(q))
    );
  }, [catFiltered, search]);

  // Quality split: enriched first, then unenriched
  const enrichedList = useMemo(
    () => sortSettlements(searchFiltered.filter(s =>
      isEnriched(s) && (daysUntil(s.claimDeadline) === null || daysUntil(s.claimDeadline)! >= 0)
    )),
    [searchFiltered],
  );
  const unenrichedCount = searchFiltered.length - enrichedList.length;
  const displayList = showAll ? searchFiltered : enrichedList;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgPage, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ ...typography.bodyBase, color: colors.textTertiary, marginTop: spacing.base }}>
          טוען הסדרים...
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <StatusBar barStyle="dark-content" />

      <FlatList
        data={displayList}
        keyExtractor={item => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <>
            {/* ── Sky gradient header ──────────────────────────── */}
            <LinearGradient
              colors={skyGradient.colors as any}
              locations={skyGradient.locations as any}
              style={{
                paddingTop: Platform.OS === 'ios' ? 60 : 40,
                paddingBottom: spacing.lg,
                paddingHorizontal: spacing.base,
              }}
            >
              <Animated.View entering={FadeIn.duration(350)}>
                {/* Top row: legal advice button + greeting */}
                <View style={{
                  flexDirection: 'row', justifyContent: 'space-between',
                  alignItems: 'center', marginBottom: spacing.md,
                }}>
                  {/* Legal advice CTA */}
                  <Pressable
                    onPress={() => router.push('/legal' as any)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      {
                        flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
                        paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
                        backgroundColor: 'rgba(26,86,219,0.12)',
                        borderRadius: radius.pill, borderWidth: 1,
                        borderColor: 'rgba(26,86,219,0.20)',
                      },
                      // Pressed feedback as a separate style entry — never set
                      // `transform: undefined` (some RN versions flatten that to
                      // null and then crash on `null.forEach`).
                      pressed ? { opacity: 0.7, transform: [{ scale: 0.97 }] } : null,
                    ]}
                  >
                    <Text style={{ fontSize: 14 }}>⚖️</Text>
                    <Text style={{ ...typography.labelSm, color: colors.primary, fontWeight: '600' }}>
                      ייעוץ משפטי
                    </Text>
                  </Pressable>

                  {/* Greeting */}
                  <Text style={{ ...typography.displayMd, color: colors.textPrimary }}>
                    היי! 👋
                  </Text>
                </View>

                {/* Search bar */}
                <View style={{
                  flexDirection: 'row-reverse', alignItems: 'center',
                  backgroundColor: '#FFFFFF', borderRadius: radius.xl,
                  paddingHorizontal: spacing.md, height: 44,
                  borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
                  ...shadows.glass,
                }}>
                  <Text style={{ fontSize: 16, marginLeft: spacing.sm }}>🔍</Text>
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="חיפוש חופשי..."
                    placeholderTextColor={colors.textDisabled}
                    textAlign="right"
                    style={{
                      flex: 1,
                      ...typography.bodyBase,
                      color: colors.textPrimary,
                      paddingVertical: 0,
                    }}
                  />
                </View>
              </Animated.View>
            </LinearGradient>

            {/* ── Category chips ───────────────────────────────── */}
            <View style={{ paddingVertical: spacing.sm }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: spacing.base, gap: spacing.sm }}
                style={{ transform: [{ scaleX: -1 }] }}
              >
                {CATEGORY_FILTERS.map(f => (
                  <View key={f.key} style={{ transform: [{ scaleX: -1 }] }}>
                    <Pressable
                      onPress={() => setCatFilter(f.key)}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 4,
                        paddingHorizontal: spacing.md, paddingVertical: 8,
                        borderRadius: radius.pill,
                        backgroundColor: catFilter === f.key ? colors.primary : '#FFF',
                        borderWidth: 1,
                        borderColor: catFilter === f.key ? colors.primary : 'rgba(0,0,0,0.08)',
                        ...(catFilter === f.key ? shadows.button : shadows.glass),
                      }}
                    >
                      <Text style={{ fontSize: 13 }}>{f.icon}</Text>
                      <Text style={{
                        ...typography.labelSm, fontWeight: '600',
                        color: catFilter === f.key ? '#FFF' : colors.textSecondary,
                      }}>{f.label}</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            </View>

            {/* ── Section title ────────────────────────────────── */}
            <View style={{
              paddingHorizontal: spacing.base,
              paddingTop: spacing.sm, paddingBottom: spacing.md,
            }}>
              <Text style={{ ...typography.h1, color: colors.textPrimary, textAlign: 'right' }}>
                התאמות חדשות בשבילך
              </Text>
            </View>

            {error && (
              <View style={{
                marginHorizontal: spacing.base, padding: spacing.base, marginBottom: spacing.sm,
                backgroundColor: colors.dangerBg, borderRadius: radius.md,
              }}>
                <Text style={{ ...typography.bodyBase, color: colors.danger, textAlign: 'right' }}>{error}</Text>
              </View>
            )}
          </>
        }
        ListFooterComponent={
          !showAll && unenrichedCount > 0 ? (
            <View style={{ marginHorizontal: spacing.base, marginBottom: spacing.md }}>
              <Pressable
                onPress={() => setShowAll(true)}
                style={{
                  padding: spacing.md, borderRadius: radius.lg,
                  backgroundColor: '#FFF', borderWidth: 1,
                  borderColor: 'rgba(0,0,0,0.06)', alignItems: 'center',
                  ...shadows.glass,
                }}
              >
                <Text style={{ ...typography.labelMd, color: colors.primary }}>
                  + הצג {unenrichedCount} הסדרים נוספים
                </Text>
              </Pressable>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl, marginTop: spacing.xxxl }}>
            <Text style={{ fontSize: 48, marginBottom: spacing.base }}>🔍</Text>
            <Text style={{ ...typography.h2, color: colors.textTertiary, textAlign: 'center' }}>
              {search.trim() ? 'לא נמצאו תוצאות' : 'אין הסדרים בקטגוריה זו'}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <SettlementCard settlement={item} index={index} />
        )}
      />
    </View>
  );
}
