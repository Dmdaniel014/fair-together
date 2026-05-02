// ─────────────────────────────────────────────────────────────────────────────
//  app/(tabs)/explore.tsx — Global search across lawsuits + incubator cases
//  Rebuilt with design-system primitives (Card / Badge / Pill) per handoff.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView,
  ActivityIndicator, StatusBar, Platform, Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { brandColor, colors, typography, spacing, radius, shadows } from '@/theme';
import { Badge, Card, Pill } from '@/components/ui';
import {
  globalSearch, SearchLawsuit, SearchIncubatorCase,
} from '@/services/api';

// 350ms debounce: balances key-stroke responsiveness with server-call thrift.
const DEBOUNCE_MS = 350;

export default function ExploreScreen() {
  const router = useRouter();
  const [query,    setQuery]    = useState('');
  const [lawsuits, setLawsuits] = useState<SearchLawsuit[]>([]);
  const [cases,    setCases]    = useState<SearchIncubatorCase[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [touched,  setTouched]  = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  const runSearch = useCallback(async (q: string) => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const r = await globalSearch(q);
      // Ignore results from stale requests (user kept typing).
      if (reqId !== reqIdRef.current) return;
      setLawsuits(r.lawsuits);
      setCases(r.cases);
    } catch (e: any) {
      if (reqId !== reqIdRef.current) return;
      setError(e?.message ?? 'שגיאה בחיפוש');
      setLawsuits([]);
      setCases([]);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setLawsuits([]); setCases([]); setLoading(false); setError(null);
      return;
    }
    setTouched(true);
    timerRef.current = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, runSearch]);

  const nothing = !loading && touched && lawsuits.length === 0 && cases.length === 0 && !error;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <StatusBar barStyle="dark-content" />

      {/* ── White header with search field ─────────────────────────── */}
      <View style={{
        paddingTop: Platform.OS === 'ios' ? 56 : 32,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.base,
        backgroundColor: colors.bgWhite,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.04)',
      }}>
        <Text style={{ ...typography.displayMd, color: colors.textPrimary, textAlign: 'right' }}>
          אקספלורר
        </Text>
        <Text style={{
          ...typography.bodySm, color: colors.textTertiary,
          textAlign: 'right', marginTop: spacing.xs,
        }}>
          חפשו תביעות ייצוגיות או יוזמות פעילות
        </Text>

        {/* Search field with magnifier glyph (right side, RTL leading) */}
        <View style={{
          marginTop: spacing.base,
          flexDirection: 'row-reverse',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.base,
          backgroundColor: colors.bgPage,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: 'rgba(0,0,0,0.06)',
        }}>
          <Text style={{ fontSize: 16, color: colors.textTertiary }}>🔍</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="חברה, מספר תיק, מילת מפתח…"
            placeholderTextColor={colors.textTertiary}
            style={{
              flex: 1,
              paddingVertical: Platform.OS === 'ios' ? 14 : 10,
              textAlign: 'right',
              writingDirection: 'rtl',
              ...typography.bodyBase,
              color: colors.textPrimary,
            }}
            returnKeyType="search"
            autoCorrect={false}
            onSubmitEditing={() => { Keyboard.dismiss(); runSearch(query.trim()); }}
          />
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        {loading && (
          <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}

        {error && (
          <Text style={{ ...typography.bodySm, color: colors.danger, textAlign: 'center' }}>
            {error}
          </Text>
        )}

        {!loading && !touched && (
          <View style={{ paddingVertical: spacing.xxl, alignItems: 'center' }}>
            <Text style={{ fontSize: 40, marginBottom: spacing.sm }}>🔎</Text>
            <Text style={{
              ...typography.bodyMd, color: colors.textTertiary, textAlign: 'center',
            }}>
              התחילו להקליד כדי לחפש
            </Text>
          </View>
        )}

        {nothing && (
          <View style={{ paddingVertical: spacing.xxl, alignItems: 'center' }}>
            <Text style={{ fontSize: 40, marginBottom: spacing.sm }}>🔍</Text>
            <Text style={{
              ...typography.bodyMd, color: colors.textTertiary, textAlign: 'center',
            }}>
              לא נמצאו תוצאות עבור "{query.trim()}"
            </Text>
          </View>
        )}

        {cases.length > 0 && (
          <SectionHeader title="יוזמות פעילות" count={cases.length} tone="info" />
        )}
        {cases.map(c => (
          <CaseRow
            key={c.id}
            c={c}
            onPress={() => router.push({ pathname: '/cases/[id]' as any, params: { id: c.id } })}
          />
        ))}

        {lawsuits.length > 0 && (
          <SectionHeader title="תביעות קיימות" count={lawsuits.length} tone="success" />
        )}
        {lawsuits.map(l => (
          <LawsuitRow
            key={l.id}
            l={l}
            onPress={() => router.push({ pathname: '/lawsuit/[id]', params: { id: l.id } })}
          />
        ))}
      </ScrollView>
    </View>
  );
}

// ── Section header ─────────────────────────────────────────────────────────
function SectionHeader({ title, count, tone }: {
  title: string; count: number; tone: 'success' | 'info';
}) {
  return (
    <View style={{
      flexDirection: 'row-reverse', justifyContent: 'space-between',
      alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm,
    }}>
      <Text style={{ ...typography.h2, color: colors.textPrimary }}>{title}</Text>
      <Pill label={`${count} תוצאות`} color={tone === 'info' ? colors.info : colors.success} />
    </View>
  );
}

// ── Lawsuit row ────────────────────────────────────────────────────────────
function LawsuitRow({ l, onPress }: { l: SearchLawsuit; onPress: () => void }) {
  const bg = brandColor(l.defendantName);
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Card onPress={onPress}>
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm,
        }}>
          {/* Brand-color logo tile */}
          <View style={{
            width: 40, height: 40, borderRadius: 12,
            backgroundColor: bg,
            alignItems: 'center', justifyContent: 'center',
            ...shadows.glass,
          }}>
            <Text style={{ fontSize: 16, color: '#FFF', fontWeight: '700' }}>
              {l.defendantName.charAt(0)}
            </Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{ ...typography.h3, color: colors.textPrimary, textAlign: 'right' }}
            >
              {l.defendantName}
            </Text>
            <Text style={{
              ...typography.caption, color: colors.textTertiary,
              textAlign: 'right', marginTop: 2,
            }}>
              {l.caseNumber}
            </Text>
          </View>

          <Badge label={l.status} tone="success" />
        </View>

        {l.summary && (
          <Text
            numberOfLines={2}
            style={{
              ...typography.bodySm, color: colors.textSecondary,
              textAlign: 'right', marginTop: spacing.sm,
            }}
          >
            {l.summary}
          </Text>
        )}
      </Card>
    </View>
  );
}

// ── Incubator case row ─────────────────────────────────────────────────────
function CaseRow({ c, onPress }: { c: SearchIncubatorCase; onPress: () => void }) {
  const score = c.powerScore != null ? Math.round(c.powerScore) : null;
  // Score → tone mapping
  const scoreTone: 'success' | 'warning' | 'neutral' =
    score == null ? 'neutral' : score >= 70 ? 'success' : score >= 40 ? 'warning' : 'neutral';

  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Card onPress={onPress} accent={colors.info}>
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm,
        }}>
          <View style={{
            width: 40, height: 40, borderRadius: 12,
            backgroundColor: 'rgba(37,99,235,0.10)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 18 }}>⚖️</Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{ ...typography.h3, color: colors.textPrimary, textAlign: 'right' }}
            >
              {c.title}
            </Text>
            <Text style={{
              ...typography.caption, color: colors.textTertiary,
              textAlign: 'right', marginTop: 2,
            }}>
              {c.defendantCompany}
            </Text>
          </View>

          {score != null && (
            <Badge label={`${score}/100`} tone={scoreTone} />
          )}
        </View>

        {/* Footer row — member count */}
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center',
          gap: spacing.sm, marginTop: spacing.sm,
        }}>
          <Pill label={`${c._count.members} חברים`} color={colors.info} />
          <Text style={{
            ...typography.caption, color: colors.textTertiary,
          }}>
            יעד: {c.goalMembers}
          </Text>
        </View>
      </Card>
    </View>
  );
}
