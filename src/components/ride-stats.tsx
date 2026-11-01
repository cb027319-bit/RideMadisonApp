// Profile stats and badges: totals from the rider's ride log plus milestone
// badges with progress, so there's always a next goal in sight.

import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BRAND, FONT } from '@/lib/config';
import { locale, useT } from '@/lib/i18n';
import { formatDuration } from '@/lib/routing';
import { badgeProgress, summarize, type RideLog } from '@/lib/stats';
import { makeStyles, useTheme } from '@/lib/theme';

function fmt(n: number, digits = 1): string {
  return n >= 100
    ? Math.round(n).toLocaleString(locale())
    : n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function Stat({ value, label }: { value: string; label: string }) {
  const { t } = useT();
  const styles = useStyles();
  return (
    <View style={styles.stat} accessible accessibilityLabel={t('more.stats.statA11y', { label, value })}>
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
  const { t } = useT();
  const { c } = useTheme();
  const styles = useStyles();
  const earned = badges.filter((b) => b.earned);
  // Next goals: closest to done first.
  const next = badges.filter((b) => !b.earned).sort((a, b) => b.value - a.value);
  const shown = showAll ? [...earned, ...next] : [...earned, ...next].slice(0, 6);

  return (
    <View style={styles.wrap}>
      {s.rides === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="bicycle" size={28} color={c.primary} />
          <Text style={styles.emptyText}>{t('more.stats.empty')}</Text>
        </View>
      ) : (
        <>
          <View style={styles.highlight}>
            <Text style={styles.bigValue}>{fmt(s.miles)}</Text>
            <Text style={styles.bigLabel}>{t('more.stats.milesRidden')}</Text>
            <Text style={styles.subLine}>
              {t('more.stats.weekMonth', { week: fmt(s.milesThisWeek), month: fmt(s.milesThisMonth) })}
              {s.weekStreak > 1 ? t('more.stats.streak', { n: s.weekStreak }) : ''}
            </Text>
          </View>
          <View style={styles.grid}>
            <Stat value={s.rides.toLocaleString(locale())} label={t('more.stats.rides')} />
            <Stat value={formatDuration(s.movingS)} label={t('more.stats.moving')} />
            <Stat value={t('common.mph', { n: fmt(s.avgMph) })} label={t('more.stats.avg')} />
            <Stat value={t('common.mph', { n: fmt(s.topMph) })} label={t('more.stats.top')} />
            <Stat value={t('common.miles', { n: fmt(s.longestMiles) })} label={t('more.stats.longest')} />
            <Stat value={t('common.feet', { n: Math.round(s.climbFt).toLocaleString(locale()) })} label={t('more.stats.climbed')} />
            <Stat value={t('more.stats.kg', { n: fmt(s.co2Kg) })} label={t('more.stats.co2')} />
            <Stat value={s.suggestedDone.toLocaleString(locale())} label={t('more.stats.suggested')} />
          </View>
        </>
      )}

      <View style={styles.badgeHead}>
        <Text style={styles.h3}>{t('more.stats.badges')}</Text>
        <Text style={styles.count}>{t('more.stats.badgeCount', { earned: earned.length, total: badges.length })}</Text>
      </View>
      <View style={styles.badges}>
        {shown.map((b) => (
          <View
            key={b.id}
            style={[styles.badge, !b.earned && styles.badgeLocked]}
            accessible
            accessibilityLabel={t('more.stats.badgeA11y', {
              name: t(b.nameKey),
              desc: t(b.descKey),
              status: b.earned ? t('more.stats.earned') : t('more.stats.percentDone', { n: Math.round(b.value * 100) }),
            })}>
            <View style={[styles.badgeIcon, b.earned ? styles.iconEarned : styles.iconLocked]}>
              <Ionicons name={b.icon} size={22} color={b.earned ? c.onGold : c.textFaint} />
            </View>
            <Text style={styles.badgeName} numberOfLines={2}>
              {t(b.nameKey)}
            </Text>
            <Text style={styles.badgeDesc} numberOfLines={3}>
              {t(b.descKey)}
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
          <Text style={styles.moreText}>{showAll ? t('more.stats.showFewer') : t('more.stats.seeAll', { count: badges.length })}</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { gap: 12 },
  empty: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: c.surface, borderRadius: 14, padding: 14 },
  emptyText: { flex: 1, fontSize: 15, color: c.text, lineHeight: 21 },
  // Navy brand card in light mode; a raised dark panel in dark mode.
  highlight: { backgroundColor: c.dark ? c.surfaceAlt : BRAND.navy, borderRadius: 16, padding: 16 },
  bigValue: { fontFamily: FONT.black, fontSize: 40, color: c.dark ? c.text : c.onPrimary },
  bigLabel: { fontFamily: FONT.bold, fontSize: 15, color: BRAND.limestone, marginTop: -4 },
  subLine: { fontSize: 14, color: c.gold, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '48.5%', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, minHeight: 68 },
  statValue: { fontFamily: FONT.black, fontSize: 20, color: c.text },
  statLabel: { fontSize: 13, color: c.textMuted, marginTop: 2 },
  badgeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 },
  h3: { fontFamily: FONT.black, fontSize: 18, color: c.text },
  count: { fontSize: 14, color: c.textMuted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { width: '31.6%', backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 10, alignItems: 'center', gap: 4 },
  badgeLocked: { backgroundColor: c.bg },
  badgeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  iconEarned: { backgroundColor: c.gold },
  iconLocked: { backgroundColor: c.surfaceAlt },
  badgeName: { fontFamily: FONT.bold, fontSize: 13, color: c.text, textAlign: 'center' },
  badgeDesc: { fontSize: 11.5, color: c.textMuted, textAlign: 'center', lineHeight: 15 },
  bar: { alignSelf: 'stretch', height: 5, borderRadius: 3, backgroundColor: c.surfaceAlt, marginTop: 4, overflow: 'hidden' },
  barFill: { height: 5, backgroundColor: c.accent },
  more: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16, minHeight: 44 },
  moreText: { fontFamily: FONT.bold, fontSize: 15, color: c.primary },
}));
