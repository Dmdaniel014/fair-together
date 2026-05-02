// ─────────────────────────────────────────────────────────────────────────────
//  app/cases/new.tsx — Founder creates a new Incubator case.
//  Single-screen form: basic info → scope → incident → narrative → evidence → submit.
//  On submit: POST /cases → POST /cases/:id/evidence (×N) → POST /cases/:id/submit.
//  Evidence in MVP = TEXT or URL (no file upload yet).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, Alert, StatusBar,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { colors, typography, spacing, radius, shadows } from '@/theme';
import * as api from '@/services/api';
import type { LegalClaimType, AffectedSize } from '@/services/api';

type EvidenceDraft = {
  id:          string;                      // local id for list key
  kind:        'TEXT' | 'URL';
  textContent: string;
  externalUrl: string;
  description: string;
};

const CLAIM_TYPES: { value: LegalClaimType; label: string }[] = [
  { value: 'MISREPRESENTATION', label: 'הטעיה צרכנית' },
  { value: 'OVERCHARGING',      label: 'חיוב יתר' },
  { value: 'DEFECTIVE_PRODUCT', label: 'מוצר פגום' },
  { value: 'POOR_SERVICE',      label: 'שירות לקוי' },
  { value: 'DISCRIMINATION',    label: 'אפליה' },
  { value: 'PRIVACY_VIOLATION', label: 'פגיעה בפרטיות' },
  { value: 'OTHER',             label: 'אחר' },
];

const AFFECTED_OPTIONS: { value: AffectedSize; label: string }[] = [
  { value: 'TENS',                  label: 'עשרות' },
  { value: 'HUNDREDS',              label: 'מאות' },
  { value: 'THOUSANDS',             label: 'אלפים' },
  { value: 'TENS_OF_THOUSANDS',     label: 'עשרות אלפים' },
  { value: 'HUNDREDS_OF_THOUSANDS', label: 'מאות אלפים' },
  { value: 'MILLIONS',              label: 'מיליונים' },
];

export default function NewCaseScreen() {
  // Form state
  const [title,             setTitle]             = useState('');
  const [defendantCompany,  setDefendantCompany]  = useState('');
  const [legalClaimType,    setLegalClaimType]    = useState<LegalClaimType | null>(null);
  const [damageEstimateNis, setDamageEstimateNis] = useState('');
  const [estimatedAffected, setEstimatedAffected] = useState<AffectedSize | null>(null);
  const [incidentDateStr,   setIncidentDateStr]   = useState(''); // free-form, parsed flexibly
  const [narrative,         setNarrative]         = useState('');
  const [evidence,          setEvidence]          = useState<EvidenceDraft[]>([]);

  const [submitting, setSubmitting] = useState(false);

  function addEvidenceItem(kind: 'TEXT' | 'URL') {
    setEvidence(prev => [...prev, {
      id: `${Date.now()}-${Math.random()}`,
      kind, textContent: '', externalUrl: '', description: '',
    }]);
  }

  function updateEvidence(id: string, patch: Partial<EvidenceDraft>) {
    setEvidence(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  }

  function removeEvidence(id: string) {
    setEvidence(prev => prev.filter(e => e.id !== id));
  }

  function validate(): string | null {
    if (title.trim().length < 3)                        return 'כותרת היוזמה חייבת להכיל לפחות 3 תווים';
    if (defendantCompany.trim().length < 2)             return 'שם החברה הנתבעת קצר מדי';
    if (!legalClaimType)                                 return 'בחר סוג עוולה';
    const damage = Number(damageEstimateNis.replace(/[,\s₪]/g, ''));
    if (!isFinite(damage) || damage <= 0)               return 'סכום נזק לא תקין';
    if (narrative.trim().length < 20)                   return 'תיאור המקרה חייב להכיל לפחות 20 תווים';
    if (incidentDateStr.trim() && !parseDateFlexibly(incidentDateStr)) {
      return 'תאריך לא תקין — נסה למשל 15/06/2025';
    }
    for (const e of evidence) {
      if (e.kind === 'TEXT' && e.textContent.trim().length < 1) return 'ראיה מסוג טקסט חייבת להכיל תוכן';
      if (e.kind === 'URL'  && !/^https?:\/\//i.test(e.externalUrl.trim())) return 'כתובת URL לא תקינה';
    }
    return null;
  }

  async function handleSubmit() {
    const err = validate();
    if (err) { Alert.alert('טופס לא תקין', err); return; }
    setSubmitting(true);
    try {
      const damage = Number(damageEstimateNis.replace(/[,\s₪]/g, ''));
      const isoDate = parseDateFlexibly(incidentDateStr);
      const iso = isoDate ? new Date(isoDate + 'T12:00:00Z').toISOString() : undefined;

      // 1. Create the case (DRAFT)
      const { case: created } = await api.createCase({
        title:             title.trim(),
        defendantCompany:  defendantCompany.trim(),
        legalClaimType:    legalClaimType!,
        damageEstimateNis: Math.round(damage),
        narrative:         narrative.trim(),
        incidentDate:      iso,
        estimatedAffected: estimatedAffected ?? undefined,
      });

      // 2. Attach evidence items sequentially
      for (const e of evidence) {
        await api.addEvidence(created.id, {
          kind:        e.kind,
          textContent: e.kind === 'TEXT' ? e.textContent.trim() : undefined,
          externalUrl: e.kind === 'URL'  ? e.externalUrl.trim() : undefined,
          description: e.description.trim() || undefined,
        });
      }

      // 3. Submit — triggers AI analyzer on the backend
      const submitRes = await api.submitCase(created.id);

      // Show AI feedback if we got it
      const score   = submitRes.aiAnalysis?.powerScore;
      const summary = submitRes.aiAnalysis?.summary;
      const rec     = submitRes.aiAnalysis?.recommendation;

      // A "weak" submission is anything that's not a clean APPROVE.
      // We don't penalize for missing affectedSize etc. — the backend analyzer
      // is calibrated not to REJECT on that. Here we offer the STRENGTHEN chat
      // as a supportive next step, not a blocker.
      const isWeak = rec === 'REVISIONS' || rec === 'REJECT' || (score != null && score < 65);

      const title2 = 'היוזמה הוגשה לבדיקה!';
      const body   = score != null && summary
        ? `ציון ניתוח AI: ${score.toFixed(1)}/100\n\n${summary}`
        : 'היוזמה נשלחה לבדיקת הצוות. נעדכן אותך ברגע שתהיה החלטה.';

      const buttons = isWeak
        ? [
            { text: 'מאוחר יותר', style: 'cancel' as const, onPress: () => router.replace('/(tabs)/profile') },
            {
              text: 'קבל ייעוץ לחיזוק הטענה',
              onPress: async () => {
                try {
                  const r = await api.createLegalThread({ mode: 'STRENGTHEN', caseId: created.id });
                  router.replace(`/legal/${r.thread.id}` as any);
                } catch (err: any) {
                  Alert.alert('שגיאה', err?.message ?? 'לא ניתן היה לפתוח ייעוץ');
                  router.replace('/(tabs)/profile');
                }
              },
            },
          ]
        : [{ text: 'חזור לפרופיל', onPress: () => router.replace('/(tabs)/profile') }];

      Alert.alert(title2, body, buttons);
    } catch (e: any) {
      Alert.alert('שגיאה', e?.message ?? 'שליחת היוזמה נכשלה');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <Stack.Screen options={{ headerShown: true, title: 'יוזמת תביעה חדשה', headerBackTitle: 'חזור' }} />
      <StatusBar barStyle="dark-content" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.base, paddingBottom: 160, gap: spacing.base }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Section 1: Basic info */}
          <Section title="פרטי היוזמה">
            <Field label="כותרת *">
              <TextInput
                value={title} onChangeText={setTitle}
                placeholder="למשל: גביית יתר בדמי חבר בחברת פרטנר"
                style={inputStyle} textAlign="right"
                maxLength={200}
              />
            </Field>

            <Field label="חברה נתבעת *">
              <TextInput
                value={defendantCompany} onChangeText={setDefendantCompany}
                placeholder="שם החברה"
                style={inputStyle} textAlign="right"
                maxLength={200}
              />
            </Field>

            <Field label="סוג עוולה *">
              <ChipGroup
                options={CLAIM_TYPES}
                value={legalClaimType}
                onChange={setLegalClaimType}
              />
            </Field>
          </Section>

          {/* Section 2: Scope */}
          <Section title="היקף הנזק">
            <Field label="נזק כלכלי אישי (₪) *">
              <TextInput
                value={damageEstimateNis} onChangeText={setDamageEstimateNis}
                placeholder="למשל: 500"
                style={inputStyle} textAlign="right"
                keyboardType="numeric" maxLength={12}
              />
            </Field>

            <Field label="כמה אנשים סביר שנפגעו באופן דומה?">
              <ChipGroup
                options={AFFECTED_OPTIONS}
                value={estimatedAffected}
                onChange={setEstimatedAffected}
              />
            </Field>
          </Section>

          {/* Section 3: Incident date */}
          <Section title="מועד האירוע (אופציונלי)">
            <Field label="תאריך האירוע">
              <TextInput
                value={incidentDateStr}
                onChangeText={t => setIncidentDateStr(autoFormatDateWhileTyping(incidentDateStr, t))}
                onBlur={() => setIncidentDateStr(prev => {
                  const iso = parseDateFlexibly(prev);
                  return iso ? formatIsoForDisplay(iso) : prev;
                })}
                placeholder="למשל 15/06/2025"
                style={inputStyle} textAlign="right"
                maxLength={10} autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
              />
            </Field>
            <DateFeedback raw={incidentDateStr} />
            <Text style={{ ...typography.caption, color: colors.textTertiary, textAlign: 'right' }}>
              כל פורמט עובד — 15/06/2025, 15.6.25, 2025-06-15 וכו׳
            </Text>
          </Section>

          {/* Section 4: Narrative */}
          <Section title="תיאור המקרה *">
            <TextInput
              value={narrative} onChangeText={setNarrative}
              placeholder="מה קרה? מתי? איך גילית? מה ניסית לעשות? ככל שהתיאור יהיה מפורט יותר, כך ה-AI והצוות יוכלו להעריך טוב יותר."
              style={{ ...inputStyle, minHeight: 140, textAlignVertical: 'top' }}
              textAlign="right" multiline maxLength={10_000}
            />
            <Text style={{ ...typography.caption, color: colors.textTertiary, textAlign: 'right', marginTop: 4 }}>
              {narrative.length} תווים (מינימום 20)
            </Text>
          </Section>

          {/* Section 5: Evidence */}
          <Section title={`ראיות (${evidence.length})`}>
            {evidence.length === 0 ? (
              <Text style={{ ...typography.caption, color: colors.textTertiary, textAlign: 'right' }}>
                אין חובה לצרף ראיות — אך הן משפרות מאוד את הסיכוי לאישור
              </Text>
            ) : (
              evidence.map(e => (
                <EvidenceRow
                  key={e.id} item={e}
                  onUpdate={patch => updateEvidence(e.id, patch)}
                  onRemove={() => removeEvidence(e.id)}
                />
              ))
            )}

            <View style={{ flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.xs }}>
              <AddBtn label="+ טקסט / ציטוט" onPress={() => addEvidenceItem('TEXT')} />
              <AddBtn label="+ קישור"         onPress={() => addEvidenceItem('URL')} />
            </View>
          </Section>

          {/* Submit */}
          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            style={{
              backgroundColor: submitting ? colors.textTertiary : colors.primary,
              height: 52, borderRadius: radius.xl,
              alignItems: 'center', justifyContent: 'center',
              marginTop: spacing.md, ...shadows.card,
            }}
          >
            {submitting
              ? <ActivityIndicator color="#FFF" />
              : <Text style={{ ...typography.labelLg, color: '#FFF', fontWeight: '700' }}>
                  שלח לבדיקה
                </Text>}
          </Pressable>

          <Text style={{ ...typography.caption, color: colors.textTertiary, textAlign: 'center' }}>
            לאחר שליחה, AI ינתח את הבקשה וצוות הפלטפורמה יבדוק אותה ידנית
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Date parsing & auto-format ──────────────────────────────────────────────
// Accepts DD/MM/YYYY (Israeli), YYYY-MM-DD, or any digit string with
// separators (/, -, ., space). Two-digit years are expanded: 00-49 → 20xx, 50-99 → 19xx.

function autoFormatDateWhileTyping(prev: string, next: string): string {
  // Strip illegal chars; allow digits + common separators
  const cleaned = next.replace(/[^\d\/\-\.\s]/g, '').slice(0, 10);
  // User is deleting → don't reformat
  if (cleaned.length < prev.length) return cleaned;
  // User typed a separator → respect their driving
  if (/[\/\-\.\s]/.test(cleaned)) return cleaned;
  // Pure digits → live-insert / in DD/MM/YYYY style
  const d = cleaned;
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}`;
}

function parseDateFlexibly(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  // Path 1: separator-based (DD/M/YY, 15.6.2025, 15 6 25 etc.)
  const parts = t.split(/[\/\-\.\s]+/).filter(Boolean);
  if (parts.length === 3 && parts.every(p => /^\d+$/.test(p))) {
    let [a, b, c] = parts;
    let y: string, m: string, d: string;
    if (a.length === 4)      { y = a; m = b; d = c; }         // YYYY M D
    else if (c.length === 4) { d = a; m = b; y = c; }         // D M YYYY
    else {
      d = a; m = b;                                            // D M YY
      const yy = parseInt(c, 10);
      y = String(yy <= 49 ? 2000 + yy : 1900 + yy);
    }
    if (d.length > 2 || m.length > 2 || y.length !== 4) return null;
    return validateIso(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  }

  // Path 2: pure digits (6 or 8 chars)
  const digits = t.replace(/\D/g, '');
  if (digits.length === 6) {
    const d = digits.slice(0, 2), m = digits.slice(2, 4);
    const yy = parseInt(digits.slice(4, 6), 10);
    const y = String(yy <= 49 ? 2000 + yy : 1900 + yy);
    return validateIso(`${y}-${m}-${d}`);
  }
  if (digits.length === 8) {
    const yearFirst = /^(19|20)\d{2}/.test(digits);
    const y = yearFirst ? digits.slice(0, 4) : digits.slice(4, 8);
    const m = yearFirst ? digits.slice(4, 6) : digits.slice(2, 4);
    const d = yearFirst ? digits.slice(6, 8) : digits.slice(0, 2);
    return validateIso(`${y}-${m}-${d}`);
  }
  return null;
}

function validateIso(iso: string): string | null {
  const dt = new Date(`${iso}T12:00:00Z`);
  if (isNaN(dt.getTime())) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null;
  return iso;
}

const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
                       'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function formatIsoForDisplay(iso: string): string {
  // Keep the canonical YYYY-MM-DD in state so parseDateFlexibly stays a fixed point
  return iso;
}

function DateFeedback({ raw }: { raw: string }) {
  if (!raw.trim()) return null;
  const iso = parseDateFlexibly(raw);
  if (!iso) {
    return (
      <Text style={{ ...typography.caption, color: colors.danger, textAlign: 'right' }}>
        לא זיהינו תאריך — השתמש בפורמט 15/06/2025
      </Text>
    );
  }
  const [y, m, d] = iso.split('-');
  return (
    <Text style={{ ...typography.caption, color: colors.success, textAlign: 'right' }}>
      ✓ {parseInt(d, 10)} ב{HEBREW_MONTHS[parseInt(m, 10) - 1]} {y}
    </Text>
  );
}

// ── Reusable form bits ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={{
        ...typography.labelSm, color: colors.textTertiary,
        textAlign: 'right', marginBottom: spacing.sm, paddingHorizontal: spacing.xs,
      }}>
        {title}
      </Text>
      <View style={{
        backgroundColor: '#FFF', borderRadius: radius.xl,
        padding: spacing.base, gap: spacing.md,
        borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)', ...shadows.card,
      }}>
        {children}
      </View>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...typography.labelSm, color: colors.textSecondary, textAlign: 'right' }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

const inputStyle = {
  ...(({} as any)),
  borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)', borderRadius: radius.md,
  padding: spacing.sm, fontSize: 15, backgroundColor: '#FAFAFA',
  color: colors.textPrimary,
};

function ChipGroup<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value:   T | null;
  onChange:(v: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.xs }}>
      {options.map(o => {
        const active = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 999,
              backgroundColor: active ? colors.primary : 'rgba(0,0,0,0.04)',
              borderWidth: 1, borderColor: active ? colors.primary : 'rgba(0,0,0,0.08)',
            }}
          >
            <Text style={{
              ...typography.labelSm, color: active ? '#FFF' : colors.textPrimary,
              fontWeight: active ? '700' : '500',
            }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function EvidenceRow({ item, onUpdate, onRemove }: {
  item:     EvidenceDraft;
  onUpdate:(patch: Partial<EvidenceDraft>) => void;
  onRemove:() => void;
}) {
  return (
    <View style={{
      backgroundColor: '#FAFAFA', borderRadius: radius.md,
      padding: spacing.sm, gap: spacing.xs,
      borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
    }}>
      <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ ...typography.labelSm, color: colors.textSecondary, fontWeight: '700' }}>
          {item.kind === 'TEXT' ? '📝 טקסט' : '🔗 קישור'}
        </Text>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Text style={{ color: colors.danger, fontSize: 16 }}>✕</Text>
        </Pressable>
      </View>

      {item.kind === 'TEXT' ? (
        <TextInput
          value={item.textContent}
          onChangeText={t => onUpdate({ textContent: t })}
          placeholder="ציטוט / תוכן..."
          style={{ ...inputStyle, minHeight: 60, textAlignVertical: 'top' }}
          textAlign="right" multiline
        />
      ) : (
        <TextInput
          value={item.externalUrl}
          onChangeText={t => onUpdate({ externalUrl: t })}
          placeholder="https://..."
          style={inputStyle} textAlign="left"
          autoCapitalize="none" keyboardType="url"
        />
      )}

      <TextInput
        value={item.description}
        onChangeText={t => onUpdate({ description: t })}
        placeholder="הסבר קצר (אופציונלי)"
        style={inputStyle} textAlign="right"
        maxLength={500}
      />
    </View>
  );
}

function AddBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1, paddingVertical: 10, borderRadius: radius.md,
        borderWidth: 1, borderColor: colors.primary,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(26,86,219,0.04)',
      }}
    >
      <Text style={{ ...typography.labelSm, color: colors.primary, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}
