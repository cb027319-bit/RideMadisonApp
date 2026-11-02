import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { HorizontalLogo } from '@/components/brand';
import { RideStats } from '@/components/ride-stats';
import { useRideLog } from '@/lib/ridelog';
import { Onboarding } from '@/components/onboarding';
import { useAuth } from '@/lib/auth';
import { BRAND, COLORS, FONT } from '@/lib/config';
import { useData } from '@/lib/data';
import { locale, useT, type LangPref } from '@/lib/i18n';
import { PATH_META, PLACE_META } from '@/lib/labels';
import { prefsSummary, usePrefs } from '@/lib/prefs';
import { makeStyles, useTheme, type AppearancePref } from '@/lib/theme';
import { TRAIL_PASS_URL } from '@/lib/trails';
import type { Key } from '@/locales';

const PRIVACY_URL = 'https://ridemadison.com/privacy';
const TERMS_URL = 'https://ridemadison.com/terms';
const PARTNERS_EMAIL = 'mailto:hello@ridemadison.com?subject=Advertising%20on%20Ride%20Madison';

const COLLECTED: Key[] = [
  'more.collectAccount',
  'more.collectRides',
  'more.collectStyle',
  'more.collectTaps',
  'more.collectEvents',
];

const GUIDES: { title: Key; body: Key; link?: { label: Key; url: string } }[] = [
  {
    title: 'more.guidePassTitle',
    body: 'more.guidePassBody',
    link: { label: 'more.guidePassLink', url: TRAIL_PASS_URL },
  },
  {
    title: 'more.guideEbikeTitle',
    body: 'more.guideEbikeBody',
    link: { label: 'more.guideEbikeLink', url: 'https://dnr.wisconsin.gov/topic/parks/recreation/biking' },
  },
  {
    title: 'more.guideBcycleTitle',
    body: 'more.guideBcycleBody',
    link: { label: 'more.guideBcycleLink', url: 'https://madison.bcycle.com' },
  },
];

/** Language names are shown in their own language (not translated). */
const LANG_NAMES = { en: 'English', es: 'Español' } as const;

/** What "Automatic" resolves to on this phone (matches i18n: Spanish phones get Spanish, others English). */
function phoneLanguageName(): string {
  try {
    return getLocales()[0]?.languageCode === 'es' ? LANG_NAMES.es : LANG_NAMES.en;
  } catch {
    return LANG_NAMES.en;
  }
}

export default function AboutScreen() {
  const { refreshAll, paths, places, stations } = useData();
  const { prefs, setPrefs } = usePrefs();
  const auth = useAuth();
  const { logs } = useRideLog();
  const { t, pref: langPref, setPref: setLangPref } = useT();
  const { c, pref: themePref, setPref: setThemePref } = useTheme();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [openGuide, setOpenGuide] = useState<number | null>(null);

  const confirmSignOut = () =>
    Alert.alert(t('more.signOutTitle'), t('more.signOutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('more.signOut'),
        onPress: () =>
          void auth.signOut().then(() => AccessibilityInfo.announceForAccessibility(t('more.signedOut')), () => {}),
      },
    ]);

  const deleteNow = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await auth.deleteAccount();
      Alert.alert(t('more.deletedTitle'), t('more.deletedBody'));
    } catch (e) {
      Alert.alert(t('more.deleteFailed'), e instanceof Error ? e.message : t('more.pleaseTryAgain'));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () => {
    if (deleting) return;
    Alert.alert(t('more.deleteTitle'), t('more.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void deleteNow() },
    ]);
  };

  const refresh = async () => {
    setBusy(true);
    await refreshAll();
    setBusy(false);
  };

  const langOptions: { value: LangPref; label: string }[] = [
    { value: 'system', label: t('more.languageAuto', { lang: phoneLanguageName() }) },
    { value: 'en', label: LANG_NAMES.en },
    { value: 'es', label: LANG_NAMES.es },
  ];
  const themeOptions: { value: AppearancePref; label: string }[] = [
    { value: 'system', label: t('more.appearanceAuto') },
    { value: 'light', label: t('more.appearanceLight') },
    { value: 'dark', label: t('more.appearanceDark') },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <HorizontalLogo height={46} />
        <Text style={styles.heroTag}>{t('more.tagline')}</Text>
      </View>
      <Text style={styles.p}>{t('more.intro')}</Text>

      {auth.configured && (
        <>
          <Text style={styles.h2} accessibilityRole="header">{t('more.account')}</Text>
          {auth.session ? (
            <View style={styles.accountBox}>
              <View style={styles.accountHead}>
                <Text style={styles.prefsText}>{auth.profile?.full_name || t('more.rider')}</Text>
                <Text style={styles.prefsHint}>{auth.session.user.email}</Text>
              </View>
              <ActionRow icon="person-outline" label={t('more.editProfile')} onPress={() => auth.openSheet('profile')} disabled={deleting} />
              <ActionRow icon="log-out-outline" label={t('more.signOut')} onPress={confirmSignOut} disabled={deleting} />
              <ActionRow
                icon="trash-outline"
                label={deleting ? t('more.deleting') : t('more.deleteAccount')}
                onPress={confirmDelete}
                disabled={deleting}
                busy={deleting}
                danger
              />
            </View>
          ) : (
            <Pressable style={styles.signInBtn} onPress={() => auth.openSheet('gate')} accessibilityRole="button">
              <Text style={styles.buttonText}>{t('more.signInCta')}</Text>
            </Pressable>
          )}
        </>
      )}

      <Text style={styles.h2} accessibilityRole="header">{t('more.yourStats')}</Text>
      {auth.session || !auth.configured ? (
        <RideStats logs={logs} />
      ) : (
        <Pressable style={styles.statsTeaser} onPress={() => auth.openSheet('gate')} accessibilityRole="button">
          <Text style={styles.prefsText}>{t('more.statsTeaserTitle')}</Text>
          <Text style={styles.prefsHint}>
            {logs.length ? t('more.statsTeaserSaved', { count: logs.length }) : t('more.statsTeaserEmpty')}
          </Text>
        </Pressable>
      )}

      <Text style={styles.h2} accessibilityRole="header">{t('more.yourRiding')}</Text>
      <Pressable style={styles.prefsRow} onPress={() => setEditing(true)} accessibilityRole="button" accessibilityHint={t('more.ridingHint')}>
        <View style={{ flex: 1 }}>
          <Text style={styles.prefsText}>{prefsSummary(prefs, t)}</Text>
          <Text style={styles.prefsHint}>{t('more.ridingSub')}</Text>
        </View>
        <Text style={styles.link}>{t('more.change')}</Text>
      </Pressable>

      <Text style={styles.settingLabel}>{t('more.language')}</Text>
      <Segmented label={t('more.language')} value={langPref} options={langOptions} onChange={setLangPref} />

      <Text style={styles.settingLabel}>{t('more.appearance')}</Text>
      <Segmented label={t('more.appearance')} value={themePref} options={themeOptions} onChange={setThemePref} />
      <Text style={styles.prefsHint}>{t('more.appearanceHint')}</Text>

      <Text style={styles.h2} accessibilityRole="header">{t('more.guides')}</Text>
      {GUIDES.map((g, i) => (
        <View key={g.title} style={styles.guide}>
          <Pressable
            style={styles.guideHead}
            onPress={() => setOpenGuide(openGuide === i ? null : i)}
            accessibilityRole="button"
            accessibilityState={{ expanded: openGuide === i }}>
            <Text style={styles.guideTitle}>{t(g.title)}</Text>
            <Ionicons name={openGuide === i ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
          </Pressable>
          {openGuide === i && (
            <View style={{ paddingBottom: 12 }}>
              <Text style={styles.p}>{t(g.body)}</Text>
              {g.link && (
                <Text style={[styles.link, { marginTop: 8 }]} accessibilityRole="link" onPress={() => Linking.openURL(g.link!.url)}>
                  {t(g.link.label)}
                </Text>
              )}
            </View>
          )}
        </View>
      ))}

      <Text style={styles.h2} accessibilityRole="header">{t('more.mapKey')}</Text>
      {Object.entries(PATH_META).map(([k, m]) => (
        <View key={k} style={styles.legendRow}>
          <View style={[styles.line, { backgroundColor: m.color }, k === 'path_unpaved' && styles.dashed]} />
          <Text style={styles.legendText}>{m.label}</Text>
        </View>
      ))}
      <View style={styles.legendRow}>
        <View style={[styles.dot, { backgroundColor: COLORS.bcycle }]} />
        <Text style={styles.legendText}>{t('more.keyBcycle')}</Text>
      </View>
      {Object.entries(PLACE_META).map(([k, m]) => (
        <View key={k} style={styles.legendRow}>
          <View style={[styles.dot, { backgroundColor: m.color }]} />
          <Text style={styles.legendText}>{m.label}</Text>
        </View>
      ))}

      <Text style={styles.h2} accessibilityRole="header">{t('more.data')}</Text>
      <Text style={styles.p}>
        {t('more.dataLoaded', {
          paths: paths.length.toLocaleString(locale()),
          places: places.length.toLocaleString(locale()),
          stations: stations.length.toLocaleString(locale()),
        })}
      </Text>
      <Pressable style={styles.button} onPress={refresh} disabled={busy} accessibilityRole="button">
        {busy ? <ActivityIndicator color={c.onPrimary} /> : <Text style={styles.buttonText}>{t('more.refresh')}</Text>}
      </Pressable>

      <Text style={styles.h2} accessibilityRole="header">{t('more.privacy')}</Text>
      <Text style={styles.p}>{t('more.privacyIntro')}</Text>
      {COLLECTED.map((k) => (
        <View key={k} style={styles.bullet}>
          <Text style={styles.bulletDot} importantForAccessibility="no" accessibilityElementsHidden>•</Text>
          <Text style={styles.bulletText}>{t(k)}</Text>
        </View>
      ))}
      <Text style={styles.p}>{t('more.privacyLocation')}</Text>
      <Text style={styles.p}>{t('more.privacyEvents')}</Text>
      <LinkRow icon="shield-checkmark-outline" label={t('more.privacyPolicy')} onPress={() => void Linking.openURL(PRIVACY_URL)} />
      <LinkRow icon="document-text-outline" label={t('more.terms')} onPress={() => void Linking.openURL(TERMS_URL)} />

      <Text style={styles.h2} accessibilityRole="header">{t('more.business')}</Text>
      <LinkRow
        icon="storefront-outline"
        label={t('more.advertise')}
        hint={t('more.advertiseHint')}
        onPress={() => void Linking.openURL(PARTNERS_EMAIL)}
      />

      <Text style={styles.h2} accessibilityRole="header">{t('more.sources')}</Text>
      <Text style={styles.p}>
        {t('more.sourcesMapData')}{' '}
        <Text style={styles.link} accessibilityRole="link" onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright')}>
          {t('more.sourcesOsm')}
        </Text>{' '}
        {t('more.sourcesRest')}
      </Text>

      <Onboarding
        key={editing ? 'open' : 'closed'}
        visible={editing}
        mode="edit"
        initial={prefs}
        onDone={(p) => {
          setPrefs(p);
          setEditing(false);
          if (auth.session) void auth.updateProfile({ bike_type: p.bike, comfort: p.comfort }).catch(() => {});
          AccessibilityInfo.announceForAccessibility(t('more.ridingSaved'));
        }}
        onSkip={() => setEditing(false)}
      />

      <Text style={styles.version}>{t('more.version', { v: Constants.expoConfig?.version ?? '0.1.0' })}</Text>
    </ScrollView>
  );
}

type IconName = keyof typeof Ionicons.glyphMap;

/** Three-way choice (radio group) with 44pt+ targets. */
function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.segBtn, i > 0 && styles.segDivider, on && styles.segOn, pressed && !on && styles.pressed]}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on, checked: on }}>
            <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={2}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ActionRow({ icon, label, onPress, disabled, busy, danger }: {
  icon: IconName; label: string; onPress: () => void; disabled?: boolean; busy?: boolean; danger?: boolean;
}) {
  const { c } = useTheme();
  const styles = useStyles();
  const color = danger ? c.danger : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.actionRow, danger && styles.dangerRow, pressed && styles.pressed, disabled && !busy && { opacity: 0.5 }]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}>
      {busy ? <ActivityIndicator color={color} /> : <Ionicons name={icon} size={20} color={color} />}
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function LinkRow({ icon, label, hint, onPress }: { icon: IconName; label: string; hint?: string; onPress: () => void }) {
  const { c } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
      accessibilityRole="link"
      accessibilityHint={hint}>
      <Ionicons name={icon} size={20} color={c.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.actionText}>{label}</Text>
        {hint && <Text style={styles.prefsHint}>{hint}</Text>}
      </View>
      <Ionicons name="open-outline" size={18} color={c.textMuted} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.bg },
  content: { padding: 20, paddingBottom: 40 },
  // The brand hero stays navy in both modes (a border lifts it off the dark background).
  hero: {
    backgroundColor: BRAND.navy, borderRadius: 20, padding: 20, gap: 10, marginBottom: 8,
    borderWidth: c.dark ? 1 : 0, borderColor: c.border,
  },
  heroTag: { color: BRAND.limestone, fontSize: 14, fontFamily: FONT.medium },
  h2: { fontSize: 18, fontFamily: FONT.black, color: c.text, marginTop: 24, marginBottom: 8 },
  p: { fontSize: 15, lineHeight: 22, color: c.text, marginTop: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  line: { width: 28, height: 4, borderRadius: 2 },
  dashed: { opacity: 0.7 },
  // Light ring in dark mode so dark pin colours (navy BCycle) stay visible.
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: c.dark ? c.textMuted : c.surface },
  legendText: { fontSize: 14, color: c.text, flex: 1 },
  button: {
    marginTop: 12, backgroundColor: c.primary, borderRadius: 10,
    paddingVertical: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center',
  },
  buttonText: { color: c.onPrimary, fontSize: 15, fontFamily: FONT.black },
  link: { color: c.primary, textDecorationLine: 'underline', fontWeight: '600' },
  accountBox: { borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.surface, overflow: 'hidden' },
  accountHead: { padding: 14 },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
  },
  dangerRow: { marginTop: 12, borderTopWidth: 1 },
  actionText: { fontSize: 16, fontFamily: FONT.bold, color: c.text, flexShrink: 1 },
  pressed: { backgroundColor: c.pressed },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, marginTop: 8,
  },
  bullet: { flexDirection: 'row', gap: 8, marginTop: 6, paddingRight: 8 },
  bulletDot: { fontSize: 15, lineHeight: 22, color: c.text },
  bulletText: { fontSize: 15, lineHeight: 22, color: c.text, flex: 1 },
  statsTeaser: { backgroundColor: c.surface, borderRadius: 14, padding: 14, gap: 4 },
  signInBtn: { backgroundColor: c.primary, borderRadius: 10, paddingVertical: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  prefsRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 14,
    backgroundColor: c.surface,
  },
  prefsText: { fontSize: 15, fontFamily: FONT.bold, color: c.text },
  prefsHint: { fontSize: 14, color: c.textMuted, marginTop: 2 },
  settingLabel: { fontSize: 15, fontFamily: FONT.bold, color: c.text, marginTop: 18, marginBottom: 8 },
  segment: {
    flexDirection: 'row', borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.surface, overflow: 'hidden',
  },
  segBtn: { flex: 1, minHeight: 48, paddingHorizontal: 6, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  segDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.border },
  segOn: { backgroundColor: c.primary },
  segText: { fontSize: 14, fontFamily: FONT.bold, color: c.text, textAlign: 'center' },
  segTextOn: { color: c.onPrimary },
  guide: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  guideHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  guideTitle: { fontSize: 16, fontFamily: FONT.bold, color: c.text, flex: 1 },
  version: { marginTop: 28, fontSize: 12, color: c.textMuted, textAlign: 'center' },
}));
