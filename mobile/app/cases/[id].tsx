// ─────────────────────────────────────────────────────────────────────────────
//  app/cases/[id].tsx — Incubator case detail + Join CTA + Group Chat
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, Alert,
  StatusBar, Share, Platform, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { colors, typography, spacing, radius } from '@/theme';
import * as api from '@/services/api';

export default function CaseDetailScreen() {
  const { id, ref } = useLocalSearchParams<{ id: string; ref?: string }>();
  const [kase, setKase]         = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [joining, setJoining]   = useState(false);
  const [joined, setJoined]     = useState(false);

  // Chat state — only active once joined
  const [messages, setMessages] = useState<api.ChatMessage[]>([]);
  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending]   = useState(false);
  const scrollRef = useRef<ScrollView>(null);

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

  const loadMessages = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getCaseChatMessages(id, { limit: 50 });
      setMessages(data.messages);
    } catch {
      // Not a member yet — silently ignore
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (joined) loadMessages();
  }, [joined, loadMessages]);

  const onJoin = async () => {
    if (!id || joining) return;
    setJoining(true);
    try {
      const r = await api.joinCase(id, ref ? { referralToken: String(ref) } : {});
      setJoined(true);
      if (!r.alreadyMember) {
        Alert.alert('הצטרפת ליוזמה! 🎉', 'תקבל עדכונים כשהיוזמה תתקדם');
      }
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
      await Share.share({ message: `${kase?.title ?? 'יוזמת תביעה ייצוגית'}\n${shareUrl}` });
    } catch (e: any) {
      if (e?.message?.includes('NOT_A_MEMBER')) {
        Alert.alert('הצטרפי קודם ליוזמה כדי לשתף');
      } else {
        Alert.alert('לא ניתן לשתף', e?.message ?? 'שגיאה');
      }
    }
  };

  const onSend = async () => {
    const body = msgInput.trim();
    if (!body || !id || sending) return;
    setSending(true);
    setMsgInput('');
    try {
      const res = await api.postCaseChatMessage(id, body);
      setMessages(prev => [...prev, res.message]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      if (res.piiStripped?.length > 0) {
        Alert.alert('פרטים אישיים הוסרו', 'פרטים מזהים הוצאו מהודעתך לפני השליחה.');
      }
    } catch (e: any) {
      Alert.alert('שגיאה בשליחה', e?.message ?? 'שגיאה');
      setMsgInput(body); // restore input on error
    } finally {
      setSending(false);
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
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bgPage }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen options={{ title: 'יוזמת תביעה', headerBackTitle: 'חזרה' }} />
      <StatusBar barStyle="dark-content" />

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
      >
        <Text style={{ ...typography.displayMd, color: colors.textPrimary, textAlign: 'right' }}>
          {kase.title}
        </Text>
        <Text style={{ ...typography.bodyMd, color: colors.textSecondary, textAlign: 'right', marginTop: spacing.xs }}>
          נגד: {kase.defendantCompany}
        </Text>

        <View style={{ flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.base, flexWrap: 'wrap' }}>
          {score != null && <Pill label={`ציון עוצמה ${score}/100`} />}
          <Pill label={`${members} חברים`} />
          <Pill label={String(kase.legalClaimType)} />
        </View>

        <SectionTitle>תיאור</SectionTitle>
        <Text style={{ ...typography.bodyMd, color: colors.textPrimary, textAlign: 'right', lineHeight: 22 }}>
          {kase.narrative}
        </Text>

        {kase.aiAnalysis && (
          <>
            <SectionTitle>ניתוח AI</SectionTitle>
            <Text style={{ ...typography.bodyMd, color: colors.textPrimary, textAlign: 'right', lineHeight: 22 }}>
              {(kase.aiAnalysis as any)?.summary ?? JSON.stringify(kase.aiAnalysis).slice(0, 500)}
            </Text>
          </>
        )}

        {/* ── Group Chat (members only) ─────────────────────────────── */}
        {joined && (
          <>
            <SectionTitle>שיחת הקבוצה</SectionTitle>
            {messages.length === 0 ? (
              <Text style={{ ...typography.bodyMd, color: colors.textSecondary, textAlign: 'right' }}>
                היו הראשונים לכתוב בקבוצה
              </Text>
            ) : (
              messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)
            )}
          </>
        )}
      </ScrollView>

      {/* ── Bottom bar ───────────────────────────────────────────────── */}
      {joined ? (
        <View style={{
          borderTopWidth: 1,
          borderTopColor: colors.borderDefault,
          backgroundColor: colors.bgWhite,
          paddingHorizontal: spacing.base,
          paddingTop: spacing.sm,
          paddingBottom: Platform.OS === 'ios' ? 28 : spacing.base,
          flexDirection: 'row-reverse',
          gap: spacing.sm,
          alignItems: 'flex-end',
        }}>
          <Pressable
            onPress={onSend}
            disabled={sending || !msgInput.trim()}
            style={({ pressed }) => ({
              paddingVertical: 10,
              paddingHorizontal: spacing.lg,
              borderRadius: radius.md,
              backgroundColor: colors.primary,
              opacity: pressed || sending || !msgInput.trim() ? 0.5 : 1,
              justifyContent: 'center',
            })}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={{ ...typography.button, color: '#fff' }}>שלח</Text>}
          </Pressable>
          <TextInput
            value={msgInput}
            onChangeText={setMsgInput}
            placeholder="כתוב הודעה..."
            placeholderTextColor={colors.textSecondary}
            multiline
            style={{
              flex: 1,
              ...typography.bodyMd,
              color: colors.textPrimary,
              backgroundColor: colors.bgPage,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.borderDefault,
              paddingHorizontal: spacing.sm,
              paddingVertical: 8,
              textAlign: 'right',
              maxHeight: 100,
            }}
          />
          <Pressable
            onPress={onShare}
            style={({ pressed }) => ({
              paddingVertical: 10,
              paddingHorizontal: spacing.base,
              borderRadius: radius.md,
              backgroundColor: colors.bgBlue,
              opacity: pressed ? 0.7 : 1,
              justifyContent: 'center',
            })}
          >
            <Text style={{ ...typography.button, color: colors.primary }}>שיתוף</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          padding: spacing.base,
          paddingBottom: Platform.OS === 'ios' ? 28 : spacing.base,
          backgroundColor: colors.bgWhite,
        }}>
          <Pressable
            onPress={onJoin}
            disabled={joining}
            style={({ pressed }) => ({
              paddingVertical: 14,
              borderRadius: radius.md,
              backgroundColor: colors.primary,
              alignItems: 'center',
              opacity: pressed || joining ? 0.7 : 1,
            })}
          >
            {joining
              ? <ActivityIndicator size="small" color={colors.bgWhite} />
              : <Text style={{ ...typography.button, color: colors.bgWhite }}>הצטרפו ליוזמה</Text>}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ msg }: { msg: api.ChatMessage }) {
  const timeStr = new Date(msg.createdAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const displayName = msg.user?.profile?.displayName ?? msg.userId?.slice(0, 8) ?? '?';
  return (
    <View style={{
      marginBottom: spacing.sm,
      alignItems: 'flex-end',
    }}>
      <View style={{
        backgroundColor: colors.bgWhite,
        borderRadius: radius.md,
        borderTopRightRadius: 2,
        padding: spacing.sm,
        maxWidth: '85%',
        borderWidth: 1,
        borderColor: colors.borderDefault,
      }}>
        <Text style={{ ...typography.labelSm, color: colors.primary, textAlign: 'right', marginBottom: 2 }}>
          {displayName}
        </Text>
        <Text style={{ ...typography.bodyMd, color: colors.textPrimary, textAlign: 'right', lineHeight: 20 }}>
          {msg.body}
        </Text>
        <Text style={{ ...typography.caption, color: colors.textSecondary, textAlign: 'left', marginTop: 2 }}>
          {timeStr}
        </Text>
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
