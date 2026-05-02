// ─────────────────────────────────────────────────────────────────────────────
//  app/(auth)/index.tsx — Onboarding (Splash → Categories) per design spec
//
//  Two stages, each rendered with primitives (Button / Card / Badge / Pill)
//  so the look matches the design-package handoff.
//
//  Stage 1 (Splash): sky gradient hero, headline, sub-copy, primary CTA.
//  Stage 2 (Categories): stage pill "1/2" + 50% progress bar, optional name
//  field inside a Card, category chips (Pill primitive in active/inactive
//  states), bottom CTA bar with secondary skip + primary continue.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, SafeAreaView, StatusBar, TextInput, ScrollView,
} from 'react-native';
import Animated, {
  FadeInDown, FadeInUp, SlideInRight, SlideOutLeft,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { colors, typography, spacing, radius, shadows, skyGradient } from '@/theme';
import { Badge, Button, Card } from '@/components/ui';
import * as api from '@/services/api';
import type { SettlementCategory } from '@/services/api';

const CATEGORIES: { key: SettlementCategory; label: string; icon: string }[] = [
  { key: 'telecom',   label: 'תקשורת',   icon: '📱' },
  { key: 'banks',     label: 'בנקים',    icon: '🏦' },
  { key: 'retail',    label: 'קמעונאות', icon: '🛒' },
  { key: 'insurance', label: 'ביטוח',    icon: '🛡️' },
  { key: 'food',      label: 'מזון',     icon: '🍎' },
  { key: 'tech',      label: 'טכנולוגיה', icon: '💻' },
  { key: 'transport', label: 'תחבורה',   icon: '✈️' },
  { key: 'health',    label: 'בריאות',   icon: '🏥' },
];

// ── Stage progress strip ────────────────────────────────────────────────────
// Tiny pill ("1/2") + a progress bar; matches the design-system header.
function StageProgress({ step, total }: { step: number; total: number }) {
  const percent = Math.round((step / total) * 100);
  return (
    <View style={{
      flexDirection: 'row-reverse',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.md,
    }}>
      <View style={{
        paddingHorizontal: 10, paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: colors.primary50,
        borderWidth: 1,
        borderColor: colors.primary + '30',
      }}>
        <Text style={{
          ...typography.labelXs,
          color: colors.primary,
          fontWeight: '700',
        }}>
          שלב {step}/{total}
        </Text>
      </View>
      <View style={{
        flex: 1, height: 4,
        borderRadius: radius.pill,
        backgroundColor: 'rgba(0,0,0,0.06)',
        overflow: 'hidden',
      }}>
        <View style={{
          width: `${percent}%`,
          height: '100%',
          backgroundColor: colors.primary,
          borderRadius: radius.pill,
        }} />
      </View>
    </View>
  );
}

// ── Category chip ───────────────────────────────────────────────────────────
// Tap-to-toggle chip — emoji + label inside a rounded pill. Active = filled
// primary; inactive = white with subtle border (per design spec).
function CategoryChip({ label, icon, selected, onPress }: {
  label: string; icon: string; selected: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row-reverse',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.primary : '#FFF',
        borderWidth: 1,
        borderColor: selected ? colors.primary : 'rgba(0,0,0,0.08)',
        opacity: pressed ? 0.85 : 1,
        ...(selected ? shadows.button : shadows.glass),
      })}
    >
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text style={{
        ...typography.labelMd,
        fontWeight: '600',
        color: selected ? '#FFF' : colors.textSecondary,
      }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const [flow, setFlow] = useState<'splash' | 'categories'>('splash');
  const [selectedCats, setCats] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleCat = useCallback((v: string) => setCats(p => {
    const s = new Set(p);
    if (s.has(v)) s.delete(v); else s.add(v);
    return s;
  }), []);

  async function handleFinish() {
    setLoading(true);
    try {
      // Register user
      await api.register(`user_${Date.now()}@fairtogether.co.il`);

      // Save simplified profile
      await api.saveSimpleOnboarding({
        displayName: name.trim() || undefined,
        selectedCategories: [...selectedCats],
      });

      router.replace('/(tabs)');
    } catch (err) {
      console.error('Onboarding error:', err);
      // Still navigate even if API fails
      router.replace('/(tabs)');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgWhite }}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bgWhite} />

      {flow === 'splash' && (
        <View style={{ flex: 1, backgroundColor: colors.bgWhite }}>
          {/* Hero — sky gradient with logo + brand mark */}
          <LinearGradient
            colors={skyGradient.colors}
            locations={skyGradient.locations}
            start={skyGradient.start}
            end={skyGradient.end}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <Animated.View entering={FadeInDown.duration(500)} style={{ alignItems: 'center', gap: spacing.md }}>
              <Text style={{ fontSize: 64 }}>💰</Text>
              <Text style={{ ...typography.displayLg, color: colors.primary, textAlign: 'center' }}>
                Fair Together
              </Text>
              <Badge label="גרסת בטא · ישראל" tone="info" />
            </Animated.View>
          </LinearGradient>

          {/* Headline + sub-copy + primary CTA */}
          <Animated.View
            entering={FadeInUp.delay(250).duration(500)}
            style={{
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.xl,
              paddingBottom: spacing.xxxl,
              gap: spacing.lg,
            }}
          >
            <Text style={{
              ...typography.displayLg,
              color: colors.textPrimary,
              textAlign: 'center',
            }}>
              כסף שמגיע לך{'\n'}מתביעות ייצוגיות
            </Text>
            <Text style={{
              ...typography.bodyLg,
              color: colors.textTertiary,
              textAlign: 'center',
              lineHeight: 26,
            }}>
              מצא הסדרי פשרה פעילים, קבל הדרכה למימוש,{'\n'}ותקבל תזכורות לפני שהדדליין עובר.
            </Text>
            <Button
              label="בואו נתחיל"
              variant="primary"
              size="lg"
              fullWidth
              onPress={() => setFlow('categories')}
            />
          </Animated.View>
        </View>
      )}

      {flow === 'categories' && (
        <Animated.View
          entering={SlideInRight.duration(260)}
          exiting={SlideOutLeft.duration(260)}
          style={{ flex: 1, backgroundColor: colors.bgPage }}
        >
          {/* Header — back link + stage progress */}
          <View style={{ paddingHorizontal: spacing.base, paddingTop: spacing.lg }}>
            <Pressable
              onPress={() => setFlow('splash')}
              hitSlop={12}
              style={{ marginBottom: spacing.md, alignSelf: 'flex-end' }}
            >
              <Text style={{ ...typography.labelMd, color: colors.primary }}>{'‹ חזרה'}</Text>
            </Pressable>

            <StageProgress step={2} total={2} />

            <Animated.View entering={FadeInDown.delay(80).duration(300)}>
              <Text style={{
                ...typography.displayMd,
                color: colors.textPrimary,
                textAlign: 'right',
                marginBottom: spacing.xs,
              }}>
                מה מעניין אותך?
              </Text>
              <Text style={{
                ...typography.bodyBase,
                color: colors.textTertiary,
                textAlign: 'right',
                marginBottom: spacing.lg,
              }}>
                בחר קטגוריות — נעדכן אותך על הסדרים חדשים
              </Text>
            </Animated.View>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: spacing.base, paddingBottom: spacing.xl }}
            showsVerticalScrollIndicator={false}
          >
            {/* Optional name input — wrapped in a Card per design spec */}
            <Animated.View entering={FadeInDown.delay(100).duration(280)} style={{ marginBottom: spacing.lg }}>
              <Card padded={false} style={{ paddingHorizontal: spacing.base, paddingVertical: spacing.sm }}>
                <Text style={{
                  ...typography.labelSm,
                  color: colors.textTertiary,
                  textAlign: 'right',
                  marginBottom: 4,
                }}>
                  שם פרטי (לא חובה)
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="למשל: דניאל"
                  placeholderTextColor={colors.textDisabled}
                  style={{
                    height: 36,
                    paddingVertical: 0,
                    ...typography.bodyBase,
                    color: colors.textPrimary,
                    textAlign: 'right',
                    writingDirection: 'rtl',
                  }}
                />
              </Card>
            </Animated.View>

            {/* Category chips — wrap-flow, RTL */}
            <View style={{
              flexDirection: 'row-reverse',
              flexWrap: 'wrap',
              gap: spacing.sm,
              justifyContent: 'flex-start',
            }}>
              {CATEGORIES.map((cat, i) => (
                <Animated.View key={cat.key} entering={FadeInDown.delay(120 + i * 40).duration(250)}>
                  <CategoryChip
                    label={cat.label}
                    icon={cat.icon}
                    selected={selectedCats.has(cat.key)}
                    onPress={() => toggleCat(cat.key)}
                  />
                </Animated.View>
              ))}
            </View>

            {/* Selected count hint */}
            {selectedCats.size > 0 && (
              <Text style={{
                ...typography.caption,
                color: colors.textTertiary,
                textAlign: 'right',
                marginTop: spacing.md,
              }}>
                {selectedCats.size} נבחרו
              </Text>
            )}
          </ScrollView>

          {/* Bottom CTA bar — primary continue + ghost skip */}
          <View style={{
            paddingHorizontal: spacing.base,
            paddingBottom: spacing.xl,
            paddingTop: spacing.base,
            backgroundColor: colors.bgPage,
            borderTopWidth: 1,
            borderTopColor: 'rgba(0,0,0,0.04)',
            gap: spacing.sm,
          }}>
            <Button
              label={selectedCats.size > 0 ? `המשך עם ${selectedCats.size} קטגוריות` : 'המשך'}
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              disabled={loading}
              onPress={handleFinish}
            />
            {selectedCats.size === 0 && (
              <Button
                label="דלג בינתיים"
                variant="ghost"
                size="md"
                fullWidth
                disabled={loading}
                onPress={handleFinish}
              />
            )}
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}
