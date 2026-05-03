// ─────────────────────────────────────────────────────────────────────────────
//  app/(tabs)/explore.tsx — Global search + "בהקמה" (In-Building) discovery feed
//  - Pre-search: shows LIVE incubator cases + CTA to start a new case
//  - While typing: debounced search across lawsuits + incubator cases
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable,
  ActivityIndicator, StatusBar, Platform, Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { brandColor, colors, typography, spacing, radius, shadows } from '@/theme';
import { Badge, Card, Pill } from '@/components/ui';
import {
  globalSearch, getLiveCases,
  SearchLawsuit, SearchIncubatorCase, LiveIncubatorCase,
} from '@/services/api';

const DEBOUNCE_MS = 350;

// ── Claim-type labels (Hebrew) ───────────────────────────────────────────────
const CLAIM_LABELS: Record<string, string> = {
  MISREPRESENTATION: 'הטעיה צרכנית',
  OVERCHARGING:      'חיוב יתר',
  DEFECTIVE_PRODUCT: 'מוצר פגום',
  POOR_SERVICE:      'שירות לקוי',
  DISCRIMINATION:    'אפליה',
  PRIVACY_VIOLATION: 'פגיעה בפרטיות',
  OTHER:             'אחר',
};

export default function ExploreScreen() {
  const router = useRouter();

  // ── Search state ──────────────────────────────────────────────────────────
  const [query,    setQuery]    = useState('');
  const [lawsuits, setLawsuits] = useState<SearchLawsuit[]>([]);
  const [cases,    setCases]    = useState<SearchIncubatorCase[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [touched,  setTouched]  = useState(false);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef  = useRef(0);

  // ── Live incubator cases (pre-search feed) ────────────────────────────────
  const [liveCases,    setLiveCases]    = useState<LiveIncubatorCase[]>([]);
  const [liveLoading,  setLiveLoading]  = useState(false);
  const [liveError,    setLiveError]    = useState<string | null>(null);
  const [liveTotal,    setLiveTotal]    = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLiveLoading(true);
    getLiveCases({ limit: 10 })
      .then(r => { if (!cancelled) { setLiveCases(r.cases); setLiveTotal(r.total); } })
      .catch(e => { if (!cancelled) setLiveError(e?.message ?? 'שגיאה בטעינת יוזמות'); })
      .finally(() => { if (!cancelled) setLiveLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Debounced search ──────────────────────────────────────────────────────
  const runSearch = useCallback(async (q: string) => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const r = await globalSearch(q);
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

  const isSearching = query.trim().length >= 2;
  const nothing = !loading && touched && lawsuits.length === 0 && cases.length === 0 && !error;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <StatusBar barStyle="dark-content" />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={{
        paddingTop: Platform.OS === 'ios' ? 56 : 32,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.base,
        backgroundColor: colors.bgWhite,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.04)',
      }}>
        <Text style={{ ...typography.displayMd, color: colors.textPrimary, textAlign: 'right' }}>
          חקירה
        </Text>
        <Text style={{
          ...typography.bodySm, color: colors.textTertiary,
          textAlign: 'right', marginTop: spacing.xs,
        }}>
          {isSearching ? 'חיפוש בתביעות ויוזמות' : 'יוזמות פעילות ובניה • חפשו כל תביעה'}
        </Text>

        {/* Search bar */}
        <View style={{
          marginTop: spacing.base,
          flexDirection: 'row-reverse',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.base,
          backgroundColor: colors.bgPage,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: isSearching ? colors.primary : 'rgba(0,0,0,0.06)',
        }}>
          <Text style={{ fontSize: 16, color: isSearching ? colors.primary : colors.textTertiary }}>
            {isSearching ? '🔍' : '🔎'}
          </Text>
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
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Text style={{ fontSize: 14, color: colors.textTertiary }}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── SEARCH RESULTS ─────────────────────────────────────────── */}
        {isSearching && (
          <>
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

            {nothing && (
              <View style={{ paddingVertical: spacing.xxl, alignItems: 'center' }}>
                <Text style={{ fontSize: 40, marginBottom: spacing.sm }}>🔍</Text>
                <Text style={{ ...typography.bodyMd, color: colors.textTertiary, textAlign: 'center' }}>
                  לא נמצאו תוצאות עבור "{query.trim()}"
                </Text>
              </View>
            )}

            {cases.length > 0 && (
              <>
                <SectionHeader title="יוזמות פעילות" count={cases.length} tone="info" />
                {cases.map(c => (
                  <CaseRow
                    key={c.id}
                    c={c}
                    onPress={() => router.push({ pathname: '/cases/[id]' as any, params: { id: c.id } })}
                  />
                ))}
              </>
            )}

            {lawsuits.length > 0 && (
              <>
                <SectionHeader title="תביעות קיימות" count={lawsuits.length} tone="success" />
                {lawsuits.map(l => (
                  <LawsuitRow
                    key={l.id}
                    l={l}
                    onPress={() => router.push({ pathname: '/lawsuit/[id]', params: { id: l.id } })}
                  />
                ))}
              </>
            )}
          </>
        )}

        {/* ── DISCOVERY FEED (pre-search) ────────────────────────────── */}
        {!isSearching && (
          <>
            {/* "Start a case" CTA banner */}
            <Pressable
              onPress={() => router.push('/cases/new' as any)}
              style={{
                backgroundColor: colors.primary,
                borderRadius: radius.xl,
                padding: spacing.base,
                marginBottom: spacing.lg,
                flexDirection: 'row-reverse',
                alignItems: 'center',
                gap: spacing.base,
                ...shadows.card,
              }}
            >
              <View style={{
                width: 48, height: 48, borderRadius: 12,
                backgroundColor: 'rgba(255,255,255,0.2)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ fontSize: 24 }}>⚡</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.h3, color: '#FFF', textAlign: 'right' }}>
                  פתחו יוזמת תביעה חדשה
                </Text>
                <Text style={{
                  ...typography.caption, color: 'rgba(255,255,255,0.75)',
                  textAlign: 'right', marginTop: 2,
                }}>
                  AI ינתח את כוח הטענה שלכם בחינם
                </Text>
              </View>
              <Text style={{ color: '#FFF', fontSize: 20 }}>‹</Text>
            </Pressable>

            {/* "בהקמה" section header */}
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center',
              justifyContent: 'space-between', marginBottom: spacing.base,
            }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs }}>
                <Text style={{ ...typography.h2, color: colors.textPrimary }}>בהקמה</Text>
                {liveTotal > 0 && (
                  <Pill label={`${liveTotal} יוזמות`} color={colors.info} />
                )}
              </View>
              <View style={{
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: colors.success,
                // Pulse-like ring using shadow
                shadowColor: colors.success,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.6,
                shadowRadius: 4,
                elevation: 2,
              }} />
            </View>

            {liveLoading && (
              <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.info} />
              </View>
            )}

            {liveError && (
              <Text style={{ ...typography.bodySm, color: colors.danger, textAlign: 'center' }}>
                {liveError}
              </Text>
            )}

            {!liveLoading && !liveError && liveCases.length === 0 && (
              <View style={{
                backgroundColor: colors.bgWhite,
                borderRadius: radius.xl,
                padding: spacing.xl,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: 'rgba(0,0,0,0.04)',
                ...shadows.card,
              }}>
                <Text style={{ fontSize: 40, marginBottom: spacing.sm }}>⚖️</Text>
                <Text style={{ ...typography.bodyMd, color: colors.textSecondary, textAlign: 'center' }}>
                  אין עדיין יוזמות פעילות
                </Text>
                <Text style={{
                  ...typography.bodySm, color: colors.textTertiary,
                  textAlign: 'center', marginTop: spacing.xs,
                }}>
                  היו הראשונים לפתוח יוזמה!
                </Text>
              </View>
            )}

            {liveCases.map(c => (
              <LiveCaseCard
                key={c.id}
                c={c}
                onPress={() => router.push({ pathname: '/cases/[id]' as any, params: { id: c.id } })}
              />
            ))}

            {liveTotal > liveCases.length && (
              <Text style={{
                ...typography.bodySm, color: colors.info,
                textAlign: 'center', marginTop: spacing.base,
              }}>
                ועוד {liveTotal - liveCases.length} יוזמות — חפשו כדי לסנן
              </Text>
            )}
          </>
        )}
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

// ── Live case card (discovery feed) ────────────────────────────────────────
function LiveCaseCard({ c, onPress }: { c: LiveIncubatorCase; onPress: () => void }) {
  const memberCount = c._count.members;
  const progress    = Math.min(memberCount / Math.max(c.goalMembers, 1), 1);
  const pct         = Math.round(progress * 100);
  const claimLabel  = CLAIM_LABELS[c.legalClaimType] ?? c.legalClaimType;
  const score       = c.powerScore != null ? Math.round(c.powerScore) : null;
  const scoreTone: 'success' | 'warning' | 'neutral' =
    score == null ? 'neutral' : score >= 70 ? 'success' : score >= 40 ? 'warning' : 'neutral';

  return (
    <View style={{ marginBottom: spacing.base }}>
      <Card onPress={onPress} accent={colors.info}>
        {/* Header row */}
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center',
          gap: spacing.sm, marginBottom: spacing.sm,
        }}>
          <View style={{
            width: 44, height: 44, borderRadius: 12,
            backgroundColor: 'rgba(37,99,235,0.10)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 20 }}>⚖️</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{
              ...typography.h3, color: colors.textPrimary, textAlign: 'right',
            }}>
              {c.title}
            </Text>
            <Text style={{
              ...typography.caption, color: colors.textTertiary,
              textAlign: 'right', marginTop: 2,
            }}>
              נגד: {c.defendantCompany}
            </Text>
          </View>
          {score != null && <Badge label={`${score}/100`} tone={scoreTone} />}
        </View>

        {/* Claim-type + damage pills */}
        <View style={{
          flexDirection: 'row-reverse', gap: spacing.xs,
          flexWrap: 'wrap', marginBottom: spacing.sm,
        }}>
          <Pill label={claimLabel}                           color={colors.warning} />
          <Pill label={`נזק משוער: ₪${c.damageEstimateNis.toLocaleString()}`} color={colors.textTertiary} />
        </View>

        {/* Member progress bar */}
        <View style={{ gap: 4 }}>
          <View style={{
            flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <Text style={{ ...typography.labelSm, color: colors.textSecondary }}>
              {memberCount} / {c.goalMembers} חברים
            </Text>
            <Text style={{ ...typography.labelSm, color: colors.info }}>
              {pct}%
            </Text>
          </View>
          <View style={{
            height: 6, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden',
          }}>
            <View style={{
              height: '100%',
              width: `${pct}%`,
              backgroundColor: pct >= 80 ? colors.success : colors.info,
              borderRadius: 3,
            }} />
          </View>
        </View>

        {/* Status badge */}
        <View style={{ flexDirection: 'row-reverse', marginTop: spacing.sm }}>
          <Badge
            label={c.status === 'GOAL_REACHED' ? 'היעד הושג!' : c.status === 'LEGAL_ACTION' ? 'הליך משפטי' : 'בהקמה'}
            tone={c.status === 'GOAL_REACHED' ? 'success' : c.status === 'LEGAL_ACTION' ? 'warning' : 'info'}
          />
        </View>
      </Card>
    </View>
  );
}

// ── Lawsuit row (search result) ────────────────────────────────────────────
function LawsuitRow({ l, onPress }: { l: SearchLawsuit; onPress: () => void }) {
  const bg = brandColor(l.defendantName);
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Card onPress={onPress}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm }}>
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
            <Text numberOfLines={1} style={{
              ...typography.h3, color: colors.textPrimary, textAlign: 'right',
            }}>
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
          <Text numberOfLines={2} style={{
            ...typography.bodySm, color: colors.textSecondary,
            textAlign: 'right', marginTop: spacing.sm,
          }}>
            {l.summary}
          </Text>
        )}
      </Card>
    </View>
  );
}

// ── Incubator search-result row ────────────────────────────────────────────
function CaseRow({ c, onPress }: { c: SearchIncubatorCase; onPress: () => void }) {
  const score = c.powerScore != null ? Math.round(c.powerScore) : null;
  const scoreTone: 'success' | 'warning' | 'neutral' =
    score == null ? 'neutral' : score >= 70 ? 'success' : score >= 40 ? 'warning' : 'neutral';

  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Card onPress={onPress} accent={colors.info}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm }}>
          <View style={{
            width: 40, height: 40, borderRadius: 12,
            backgroundColor: 'rgba(37,99,235,0.10)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 18 }}>⚖️</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{
              ...typography.h3, color: colors.textPrimary, textAlign: 'right',
            }}>
              {c.title}
            </Text>
            <Text style={{
              ...typography.caption, color: colors.textTertiary,
              textAlign: 'right', marginTop: 2,
            }}>
              {c.defendantCompany}
            </Text>
          </View>
          {score != null && <Badge label={`${score}/100`} tone={scoreTone} />}
        </View>
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center',
          gap: spacing.sm, marginTop: spacing.sm,
        }}>
          <Pill label={`${c._count.members} חברים`} color={colors.info} />
          <Text style={{ ...typography.caption, color: colors.textTertiary }}>
            יעד: {c.goalMembers}
          </Text>
        </View>
      </Card>
    </View>
  );
}
