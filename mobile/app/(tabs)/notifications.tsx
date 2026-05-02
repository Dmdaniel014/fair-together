// ─────────────────────────────────────────────────────────────────────────────
//  app/(tabs)/notifications.tsx — Notifications feed
//  Matches design-package → Screens.jsx → NotificationsScreen.
//  Derives items from user's cases + claims, grouped by day (Hebrew labels).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StatusBar,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { colors, typography, spacing, radius, shadows, formatRelativeDate } from '@/theme';
import { getMySettlements, getMyCases, UserClaim, IncubatorCase } from '@/services/api';

// ── Types ────────────────────────────────────────────────────────────────────
type NotifKind =
  | 'MATCH'          // נמצאה התאמה חדשה
  | 'DEADLINE'       // תזכורת — מועד אחרון מתקרב
  | 'STATUS'         // עדכון סטטוס
  | 'SYSTEM';        // מערכת

interface Notif {
  id: string;
  kind: NotifKind;
  tag: string;
  tagColor: string;
  icon: string;
  title: string;
  body: string;
  time: string;       // localized
  iso: string;        // for sort / group
  unread: boolean;
  href?: string;      // tap target
}

// ── Hebrew calendar helpers ──────────────────────────────────────────────────
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function groupLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, now)) return 'היום';
  if (isSameDay(d, yesterday)) return 'אתמול';
  const daysAgo = Math.floor((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000);
  if (daysAgo < 7) return 'השבוע';
  if (daysAgo < 30) return 'החודש';
  return 'ישן יותר';
}
function hhmm(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function relativeHe(iso: string): string {
  const now = Date.now();
  const diffMs = now - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'הרגע';
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? 'לפני שעה' : hours === 2 ? 'לפני שעתיים' : `לפני ${hours} שעות`;
  return hhmm(iso);
}

// ── Derivation from cases + claims ──────────────────────────────────────────
function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.floor(diff / 86_400_000);
}

function deriveNotifications(
  claims: UserClaim[],
  cases: IncubatorCase[],
): Notif[] {
  const out: Notif[] = [];

  // Deadline reminders from claims
  claims.forEach((c) => {
    const lawsuit = c.lawsuit;
    const deadline = lawsuit?.claimDeadline ?? null;
    const d = daysUntil(deadline);
    if (d !== null && d >= 0 && d <= 7) {
      out.push({
        id: `deadline-${c.id}`,
        kind: 'DEADLINE',
        tag: 'תזכורת',
        tagColor: colors.primary,
        icon: '📅',
        title: 'מועד אחרון מתקרב',
        body: `נותרו ${d === 0 ? 'פחות מיום' : d === 1 ? 'יום אחד' : `${d} ימים`} להגיש בקשה ב${lawsuit?.defendantName || 'תיק פעיל'}.`,
        iso: new Date(Date.now() - d * 86_400_000 + 3_600_000).toISOString(),
        time: '',
        unread: true,
        href: `/settlement/${lawsuit?.id}`,
      });
    }

    // Status updates (claim was recently updated)
    if (c.updatedAt) {
      const ageDays = daysUntil(c.updatedAt);
      if (ageDays !== null && ageDays >= -14) {
        out.push({
          id: `status-${c.id}-${c.action}`,
          kind: 'STATUS',
          tag: 'עדכון סטטוס',
          tagColor: colors.textTertiary,
          icon: '🔎',
          title: lawsuit?.defendantName || 'עדכון תביעה',
          body: statusCopy(c.action),
          iso: c.updatedAt,
          time: '',
          unread: false,
          href: `/claim/${c.id}`,
        });
      }
    }
  });

  // Case lifecycle events
  cases.forEach((k) => {
    if (k.updatedAt) {
      out.push({
        id: `case-${k.id}`,
        kind: 'STATUS',
        tag: 'יוזמת תביעה',
        tagColor: '#7C3AED',
        icon: '⚡',
        title: k.defendantCompany || k.title || 'יוזמה שלך',
        body: caseStatusCopy(k.status),
        iso: k.updatedAt,
        time: '',
        unread: false,
        href: `/cases/${k.id}`,
      });
    }
  });

  // Fill timestamps
  out.forEach((n) => { n.time = relativeHe(n.iso); });

  // Sort newest first
  out.sort((a, b) => new Date(b.iso).getTime() - new Date(a.iso).getTime());

  return out;
}

function statusCopy(s?: string): string {
  switch (s) {
    case 'JOINED':    return 'התביעה שלך מתקדמת יפה — ממשיכים לעקוב עבורך.';
    case 'SAVED':     return 'שמרת את התיק. נעדכן אותך על כל שינוי חשוב.';
    case 'DISMISSED': return 'התיק הוסר מהרשימה שלך.';
    default:          return 'יש עדכון חדש בתיק.';
  }
}

function caseStatusCopy(s?: string): string {
  switch (s) {
    case 'DRAFT':                return 'היוזמה שלך בטיוטה — השלם פרטים כדי להגיש.';
    case 'PENDING_REVIEW':       return 'היוזמה הוגשה לבדיקת המערכת.';
    case 'REVISIONS_REQUESTED':  return 'היוזמה דורשת תיקונים — בדוק את ההערות.';
    case 'LIVE':                 return 'היוזמה עלתה לאוויר — תגייס חברים נוספים!';
    case 'GOAL_REACHED':         return 'הגעת ליעד! היוזמה עוברת להמשך טיפול.';
    case 'LEGAL_ACTION':         return 'היוזמה עברה לטיפול משפטי.';
    case 'CLOSED':                return 'היוזמה נסגרה.';
    case 'REJECTED':             return 'היוזמה לא אושרה.';
    default:                     return 'יש עדכון חדש ביוזמה.';
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function NotificationsScreen() {
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markedAllRead, setMarkedAllRead] = useState(false);

  async function load() {
    try {
      const [s, k] = await Promise.all([
        getMySettlements().catch(() => ({ settlements: [] as UserClaim[], total: 0 })),
        getMyCases().catch(() => ({ cases: [] as IncubatorCase[], total: 0 })),
      ]);
      setItems(deriveNotifications(s.settlements || [], k.cases || []));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function onRefresh() {
    setRefreshing(true);
    setMarkedAllRead(false);
    await load();
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, Notif[]>();
    items.forEach((n) => {
      const g = groupLabel(n.iso);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(n);
    });
    return Array.from(groups.entries());
  }, [items]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={styles.headerBtn}
          onPress={() => router.push('/(tabs)/profile' as any)}
          accessibilityLabel="העדפות התראות"
        >
          <Text style={{ fontSize: 16 }}>⚙</Text>
        </Pressable>
        <Text style={[typography.displayMd, { color: colors.textPrimary }]}>
          הודעות
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading && items.length === 0 ? (
          <View style={{ padding: spacing.xxl, alignItems: 'center' }}>
            <Text style={[typography.bodyBase, { color: colors.textTertiary }]}>טוען…</Text>
          </View>
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {grouped.map(([label, list]) => (
              <View key={label}>
                <Text style={styles.groupLabel}>{label}</Text>
                {list.map((n) => (
                  <NotifRow
                    key={n.id}
                    notif={n}
                    onPress={n.href ? () => router.push(n.href as any) : undefined}
                    markedAllRead={markedAllRead}
                  />
                ))}
              </View>
            ))}

            {items.some((n) => n.unread) && !markedAllRead && (
              <View style={{ alignItems: 'center', padding: spacing.base }}>
                <Pressable onPress={() => setMarkedAllRead(true)}>
                  <Text style={styles.markAllLink}>סמן הכל כנקרא</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <View style={{
      alignItems: 'center', justifyContent: 'center',
      paddingTop: 80, paddingHorizontal: spacing.xxl,
    }}>
      <Text style={{ fontSize: 56, marginBottom: spacing.base }}>✉️</Text>
      <Text style={[typography.h1, { color: colors.textPrimary, textAlign: 'center' }]}>
        אין הודעות חדשות
      </Text>
      <Text style={{
        ...typography.bodyLg,
        color: colors.textTertiary,
        textAlign: 'center',
        marginTop: spacing.sm,
        lineHeight: 22,
      }}>
        כשיהיו עדכונים על תביעות ואירועים חדשים — נודיע לך כאן.
      </Text>
    </View>
  );
}

// ── Notification row ─────────────────────────────────────────────────────────
function NotifRow({
  notif,
  onPress,
  markedAllRead,
}: {
  notif: Notif;
  onPress?: () => void;
  markedAllRead: boolean;
}) {
  const unread = notif.unread && !markedAllRead;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && onPress ? { opacity: 0.9 } : null,
      ]}
    >
      {/* Icon circle — leftmost in LTR, rightmost in RTL row-reverse */}
      <View style={styles.iconCircle}>
        <Text style={{ fontSize: 16 }}>{notif.icon}</Text>
      </View>

      {/* Text block */}
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <View style={{
          flexDirection: 'row-reverse',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
        }}>
          <Text style={{
            fontSize: 11,
            color: notif.tagColor,
            fontWeight: '600',
            fontFamily: 'Heebo_600SemiBold',
          }}>
            {notif.tag}
          </Text>
          <Text style={{ fontSize: 11, color: colors.textTertiary }}>
            · {notif.time}
          </Text>
        </View>
        <Text style={{
          ...typography.labelMd,
          color: colors.textPrimary,
          fontWeight: '700',
          textAlign: 'right',
        }}>
          {notif.title}
        </Text>
        <Text style={{
          fontSize: 12,
          color: colors.textTertiary,
          lineHeight: 18,
          textAlign: 'right',
          marginTop: 2,
        }}>
          {notif.body}
        </Text>
      </View>

      {/* Unread dot — inside row, at the top */}
      {unread ? <View style={styles.unreadDot} /> : <View style={{ width: 7 }} />}
    </Pressable>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.bgWhite,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.bgPanel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupLabel: {
    marginTop: spacing.base,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    fontSize: 11,
    color: colors.textTertiary,
    fontWeight: '500',
    textAlign: 'right',
  },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: spacing.base,
    marginBottom: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.bgWhite,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.10)',
    ...shadows.card,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.bgWhite,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  markAllLink: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
});

// Silence unused-var lint when formatRelativeDate is not used in a given build
void formatRelativeDate;
