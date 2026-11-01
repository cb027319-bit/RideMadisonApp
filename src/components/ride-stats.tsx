// Profile stats and badges: totals from the rider's ride log plus milestone
// badges with progress, so there's always a next goal in sight.

import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BRAND, COLORS, FONT } from '@/lib/config';
import { formatDuration } from '@/lib/routing';
import { badgeProgress, summarize, type RideLog } from '@/lib/stats';

function fmt(n: number, digits = 1): string {
  return n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(digits);
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function RideStats({ logs }: { logs: RideLog[] }) {
  const s = useMemo(() => summarize(logs), [logs]);
  const badges = useMemo(() => badgeProgress(logs), [logs]);
  const [showAll, setShowAll] = useState(false);
  const earned = badges.filter((b) => b.earned);
  // Next goals: closest to done first.
  const next = badges.filter((b) => !b.earned).sort((a, b) => b.value - a.value);
  const shown = showAll ? [...earned, ...next] : [...earned, ...next].slice(0, 6);

  return (
    <View style={styles.wrap}>
      {s.rides === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="bicycle" size={28} color={BRAND.navy} />
          <Text style={styles.emptyText}>
            Start a ride with turn-by-turn directions and your miles, speed and badges will show up here.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.highlight}>
            <Text style={styles.bigValue}>{fmt(s.miles)}</Text>
            <Text style={styles.bigLabel}>miles ridden</Text>
            <Text style={styles.subLine}>
              {fmt(s.milesThisWeek)} mi this week · {fmt(s.milesThisMonth)} mi this month
              {s.weekStreak > 1 ? ` · ${s.weekStreak}-week streak` : ''}
            </Text>
          </View>
          <View style={styles.grid}>
            <Stat value={String(s.rides)} label="Rides" />
            <Stat value={formatDuration(s.movingS)} label="Moving time" />
            <Stat value={`${s.avgMph.toFixed(1)} mph`} label="Avg speed" />
            <Stat value={`${s.topMph.toFixed(1)} mph`} label="Top speed" />
            <Stat value={`${fmt(s.longestMiles)} mi`} label="Longest ride" />
            <Stat value={`${Math.round(s.climbFt).toLocaleString()} ft`} label="Climbed" />
            <Stat value={`${fmt(s.co2Kg)} kg`} label="CO₂ saved" />
            <Stat value={String(s.suggestedDone)} label="Suggested rides done" />
          </View>
        </>
      )}

      <View style={styles.badgeHead}>
        <Text style={styles.h3}>Badges</Text>
        <Text style={styles.count}>
          {earned.length} of {badges.length}
        </Text>
      </View>
      <View style={styles.badges}>
        {shown.map((b) => (
          <View
            key={b.id}
            style={[styles.badge, !b.earned && styles.badgeLocked]}
            accessible
            accessibilityLabel={`${b.name}. ${b.description}. ${b.earned ? 'Earned' : `${Math.round(b.value * 100)} percent done`}`}>
            <View style={[styles.badgeIcon, b.earned ? styles.iconEarned : styles.iconLocked]}>
              <Ionicons name={b.icon} size={22} color={b.earned ? BRAND.navy : '#9AA0AC'} />
            </View>
            <Text style={styles.badgeName} numberOfLines={2}>
              {b.name}
            </Text>
            <Text style={styles.badgeDesc} numberOfLines={3}>
              {b.description}
            </Text>
            {!b.earned && (
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.max(4, b.value * 100)}%` }]} />
              </View>
            )}
          </View>
        ))}
      </View>
      {badges.length > 6 && (
        <Pressable onPress={() => setShowAll((v) => !v)} style={styles.more} accessibilityRole="button">
          <Text style={styles.moreText}>{showAll ? 'Show fewer badges' : `See all ${badges.length} badges`}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  empty: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14 },
  emptyText: { flex: 1, fontSize: 15, color: COLORS.text, lineHeight: 21 },
  highlight: { backgroundColor: BRAND.navy, borderRadius: 16, padding: 16 },
  bigValue: { fontFamily: FONT.black, fontSize: 40, color: '#fff' },
  bigLabel: { fontFamily: FONT.bold, fontSize: 15, color: BRAND.limestone, marginTop: -4 },
  subLine: { fontSize: 14, color: BRAND.gold, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '48.5%', backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E1D8', borderRadius: 12, padding: 12, minHeight: 68 },
  statValue: { fontFamily: FONT.black, fontSize: 20, color: COLORS.text },
  statLabel: { fontSize: 13, color: BRAND.slate, marginTop: 2 },
  badgeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 },
  h3: { fontFamily: FONT.black, fontSize: 18, color: COLORS.text },
  count: { fontSize: 14, color: BRAND.slate },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { width: '31.6%', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E1D8', padding: 10, alignItems: 'center', gap: 4 },
  badgeLocked: { backgroundColor: '#FAFAF8' },
  badgeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  iconEarned: { backgroundColor: BRAND.gold },
  iconLocked: { backgroundColor: '#EEECE7' },
  badgeName: { fontFamily: FONT.bold, fontSize: 13, color: COLORS.text, textAlign: 'center' },
  badgeDesc: { fontSize: 11.5, color: BRAND.slate, textAlign: 'center', lineHeight: 15 },
  bar: { alignSelf: 'stretch', height: 5, borderRadius: 3, backgroundColor: '#EEECE7', marginTop: 4, overflow: 'hidden' },
  barFill: { height: 5, backgroundColor: BRAND.red },
  more: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16, minHeight: 44 },
  moreText: { fontFamily: FONT.bold, fontSize: 15, color: BRAND.navy },
});
