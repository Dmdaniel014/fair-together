// ─────────────────────────────────────────────────────────────────────────────
//  app/legal/[id].tsx — Chat screen for a single LegalThread.
//
//  Matches design spec:
//    · STRENGTHEN badge in the header when thread.mode === 'STRENGTHEN'
//    · Chat bubbles with per-corner radii (18px default + 4px "tail" corner)
//    · Suggestion chips shown in the empty state to prompt the first message
//    · Primitive-based CTAs (Button, Badge) for the stage-2 escalation action
//  Keyboard-avoiding scroll of message bubbles + input bar at the bottom.
//  On send: append user bubble locally, await server reply, append assistant bubble.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator,
  StatusBar, TextInput, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { colors, typography, spacing, radius, shadows } from '@/theme';
import { Badge, Button } from '@/components/ui';
import * as api from '@/services/api';
import type { LegalMessage, LegalThread } from '@/services/api';

// ── Suggestion chips shown in the empty state ───────────────────────────────
const SUGGESTIONS_GENERAL = [
  'זכויות צרכן בקניות אונליין',
  'החזר כספי על מוצר פגום',
  'איך להגיש תביעה קטנה?',
];

const SUGGESTIONS_STRENGTHEN = [
  'מה חסר כדי לחזק את היוזמה?',
  'איך אני מוכיח נזק כספי?',
  'איזה מסמכים כדאי לצרף?',
];

export default function LegalThreadChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const threadId = id!;

  const [thread, setThread]     = useState<LegalThread | null>(null);
  const [messages, setMessages] = useState<LegalMessage[]>([]);
  const [loading, setLoading]   = useState(true);
  const [draft, setDraft]       = useState('');
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.getLegalThread(threadId);
      setThread(r.thread);
      setMessages(r.thread.messages ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => { load(); }, [load]);

  // Scroll to bottom whenever the message count grows.
  useEffect(() => {
    // Small delay so the layout measures first.
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [messages.length, sending]);

  const sendText = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    // Optimistic user bubble — gets a temp id which the real row replaces on next reload.
    const tempId = `tmp_${Date.now()}`;
    const optimistic: LegalMessage = {
      id:        tempId,
      threadId,
      role:      'USER',
      content:   trimmed,
      model:     null,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setDraft('');
    setSending(true);

    try {
      const { assistant, model } = await api.postLegalMessage(threadId, trimmed);
      setMessages(prev => [...prev, {
        id:        `asst_${Date.now()}`,
        threadId,
        role:      'ASSISTANT',
        content:   assistant,
        model,
        createdAt: new Date().toISOString(),
      }]);
    } catch (e: any) {
      // Roll back the optimistic user bubble so the user can retry.
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setDraft(trimmed);
      Alert.alert('שגיאה', e?.message ?? 'ההודעה לא נשלחה');
    } finally {
      setSending(false);
    }
  }, [sending, threadId]);

  const send = useCallback(() => { sendText(draft); }, [draft, sendText]);

  async function escalate() {
    Alert.alert(
      'העברה לעורך דין',
      'האם להעביר את השיחה לבדיקה של עורך דין אמיתי? פיצ׳ר זה עדיין בפיתוח ואינו מתחבר לעורך דין בפועל.',
      [
        { text: 'ביטול', style: 'cancel' },
        { text: 'העבר',  onPress: async () => {
          try {
            await api.escalateLegalThread(threadId);
            await load();
            Alert.alert('נשלח', 'השיחה סומנה להעברה לעורך דין');
          } catch (e: any) {
            Alert.alert('שגיאה', e?.message ?? 'נכשל');
          }
        } },
      ],
    );
  }

  const headerTitle = thread?.title ?? (thread?.mode === 'STRENGTHEN' ? 'חיזוק יוזמה' : 'ייעוץ משפטי');
  const isStrengthen = thread?.mode === 'STRENGTHEN';
  const suggestions  = isStrengthen ? SUGGESTIONS_STRENGTHEN : SUGGESTIONS_GENERAL;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgPage, justifyContent: 'center', alignItems: 'center' }}>
        <Stack.Screen options={{ headerShown: true, title: 'ייעוץ משפטי', headerBackTitle: 'חזור' }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgPage, justifyContent: 'center', alignItems: 'center', padding: spacing.base }}>
        <Stack.Screen options={{ headerShown: true, title: 'שגיאה', headerBackTitle: 'חזור' }} />
        <Text style={{ ...typography.bodyBase, color: colors.danger, textAlign: 'center' }}>{error}</Text>
        <Pressable onPress={load} style={{ marginTop: spacing.md, padding: spacing.sm }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>נסה שוב</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      style={{ flex: 1, backgroundColor: colors.bgPage }}
    >
      <Stack.Screen options={{ headerShown: true, title: headerTitle, headerBackTitle: 'חזור' }} />
      <StatusBar barStyle="dark-content" />

      {/* STRENGTHEN header strip — sits under the native header */}
      {isStrengthen && (
        <View style={{
          backgroundColor: '#FFF',
          paddingHorizontal: spacing.base,
          paddingVertical: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(0,0,0,0.06)',
          flexDirection: 'row-reverse',
          alignItems: 'center',
          gap: spacing.sm,
        }}>
          <Badge label="מצב: חיזוק תיק · STRENGTHEN" tone="warning" />
          {thread?.case?.powerScore != null && (
            <Text style={{ ...typography.caption, color: colors.textTertiary, flex: 1, textAlign: 'left' }}>
              ציון נוכחי {thread.case.powerScore.toFixed(0)}/100
            </Text>
          )}
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: spacing.base, paddingBottom: spacing.base, gap: spacing.sm }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Context banner for STRENGTHEN threads — ties the chat to its case */}
        {isStrengthen && thread?.case && (
          <View style={{
            backgroundColor: 'rgba(26,86,219,0.06)',
            borderRadius: radius.lg,
            padding: spacing.sm,
            borderWidth: 1,
            borderColor: 'rgba(26,86,219,0.12)',
          }}>
            <Text style={{ ...typography.caption, color: '#1A56DB', textAlign: 'right', fontWeight: '700' }}>
              קשור ליוזמה: {thread.case.title}
            </Text>
            {thread.case.powerScore != null && (
              <Text style={{ ...typography.caption, color: '#1A56DB', textAlign: 'right' }}>
                המטרה שלנו כאן להעלות את הציון.
              </Text>
            )}
          </View>
        )}

        {/* Empty state — prompt the user + suggestion chips */}
        {messages.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
            <Text style={{ fontSize: 48 }}>⚖️</Text>
            <Text style={{ ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm, textAlign: 'center' }}>
              {isStrengthen ? 'בוא נחזק את היוזמה' : 'איך אפשר לעזור?'}
            </Text>
            <Text style={{ ...typography.bodyBase, color: colors.textTertiary, marginTop: 4, textAlign: 'center', paddingHorizontal: spacing.base }}>
              {isStrengthen
                ? 'שאל מה חסר, וספר לי פרטים נוספים שזכרת'
                : 'שאל על זכויות צרכן, עילות תביעה, או כל נושא משפטי'}
            </Text>

            {/* Suggestion chips — tap to send immediately */}
            <View style={{
              flexDirection: 'row-reverse',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: spacing.sm,
              marginTop: spacing.lg,
              paddingHorizontal: spacing.sm,
            }}>
              {suggestions.map(s => (
                <SuggestionChip key={s} label={s} onPress={() => sendText(s)} />
              ))}
            </View>
          </View>
        )}

        {messages.map(m => <Bubble key={m.id} m={m} />)}

        {sending && (
          <View style={{
            alignSelf: 'flex-end',
            flexDirection: 'row-reverse',
            alignItems: 'center',
            gap: spacing.xs,
            paddingHorizontal: spacing.sm,
          }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ ...typography.caption, color: colors.textTertiary }}>חושב...</Text>
          </View>
        )}
      </ScrollView>

      {/* Stage-2 escalate — visible once the conversation has substance */}
      {thread && messages.length >= 4 && thread.status === 'ACTIVE' && (
        <View style={{ marginHorizontal: spacing.base, marginBottom: spacing.xs }}>
          <Button
            label="👨‍⚖️  העבר לעורך דין אמיתי (שלב 2)"
            variant="secondary"
            size="md"
            fullWidth
            onPress={escalate}
          />
        </View>
      )}

      {/* Input bar */}
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'flex-end',
        padding: spacing.sm, gap: spacing.sm,
        backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)',
      }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="כתוב הודעה..."
          placeholderTextColor={colors.textDisabled}
          multiline
          editable={!sending && thread?.status !== 'ARCHIVED'}
          style={{
            flex: 1, backgroundColor: colors.bgPage, borderRadius: radius.lg,
            paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
            textAlign: 'right', writingDirection: 'rtl',
            minHeight: 40, maxHeight: 140,
            ...typography.bodyBase, color: colors.textPrimary,
          }}
        />
        <Pressable
          onPress={send}
          disabled={sending || !draft.trim()}
          style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: draft.trim() && !sending ? colors.primary : colors.textDisabled,
            alignItems: 'center', justifyContent: 'center',
            ...shadows.card,
          }}
        >
          <Text style={{ color: '#FFF', fontSize: 18, fontWeight: '700' }}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Bubble ─────────────────────────────────────────────────────────────────
// Per design spec: 18px rounded on three corners, 4px "tail" on the corner
// nearest the sender. Assistant tail = bottom-right; user tail = bottom-left.
function Bubble({ m }: { m: LegalMessage }) {
  const isUser = m.role === 'USER';

  // Tail on the same side as the speaker (user-left / assistant-right)
  const bubbleShape = isUser
    ? {
        borderTopLeftRadius:     18,
        borderTopRightRadius:    18,
        borderBottomLeftRadius:  4,
        borderBottomRightRadius: 18,
      }
    : {
        borderTopLeftRadius:     18,
        borderTopRightRadius:    18,
        borderBottomLeftRadius:  18,
        borderBottomRightRadius: 4,
      };

  return (
    <View style={{
      alignSelf: isUser ? 'flex-start' : 'flex-end',
      backgroundColor: isUser ? colors.primary : '#FFF',
      ...bubbleShape,
      borderWidth: isUser ? 0 : 1,
      borderColor: 'rgba(0,0,0,0.06)',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      maxWidth: '86%',
      ...shadows.card,
    }}>
      <Text style={{
        ...typography.bodyBase,
        color: isUser ? '#FFF' : colors.textPrimary,
        textAlign: 'right',
        writingDirection: 'rtl',
      }}>
        {m.content}
      </Text>
    </View>
  );
}

// ── Suggestion chip ────────────────────────────────────────────────────────
// White pill with primary-blue border; tap fires the full prompt as a message.
function SuggestionChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.base,
        paddingVertical: 10,
        borderRadius: radius.pill,
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: colors.primary,
        opacity: pressed ? 0.7 : 1,
        ...shadows.glass,
      })}
    >
      <Text style={{
        ...typography.labelMd,
        color: colors.primary,
        fontWeight: '600',
      }}>
        {label}
      </Text>
    </Pressable>
  );
}
