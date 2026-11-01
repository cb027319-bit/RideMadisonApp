import Constants from 'expo-constants';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { HorizontalLogo } from '@/components/brand';
import { RideStats } from '@/components/ride-stats';
import { useRideLog } from '@/lib/ridelog';
import { TAGLINE } from '@/components/launch-screen';
import { Onboarding } from '@/components/onboarding';
import { useAuth } from '@/lib/auth';
import { BRAND, COLORS, FONT } from '@/lib/config';
import { useData } from '@/lib/data';
import { PATH_META, PLACE_META } from '@/lib/labels';
import { BIKE_OPTIONS, COMFORT_OPTIONS, usePrefs } from '@/lib/prefs';
import { TRAIL_PASS_URL } from '@/lib/trails';

const GUIDES: { title: string; body: string; link?: { label: string; url: string } }[] = [
  {
    title: 'Do I need a trail pass?',
    body:
      'Wisconsin state trails such as the Military Ridge, Badger and Glacial Drumlin require a state trail pass to bike if you are 16 or older: $5 for a day or $25 for the year. On the Capital City State Trail the pass applies only to the 9 miles between Verona Rd and Nob Hill Rd. City paths like the Southwest Commuter Path are free. Walking never needs a pass. Tap any trail on the map to see its rules.',
    link: { label: 'Buy a pass from the WI DNR', url: TRAIL_PASS_URL },
  },
  {
    title: 'E-bikes on trails',
    body:
      'Wisconsin has three e-bike classes. On most DNR state trails, Class 1 and Class 3 e-bikes are generally allowed at up to 15 mph, and Class 2 (throttle) e-bikes are not allowed under motor power. City and county paths can set their own rules, so check posted signs.',
    link: { label: 'WI DNR biking page', url: 'https://dnr.wisconsin.gov/topic/parks/recreation/biking' },
  },
  {
    title: 'Riding Madison BCycle',
    body:
      'BCycle is Madison’s bike share, and its fleet is electric-assist. Tap a red bike icon on the map to see how many bikes and open docks a station has right now, then unlock a bike in the BCycle app and return it to any station with an open dock.',
    link: { label: 'Madison BCycle', url: 'https://madison.bcycle.com' },
  },
];

export default function AboutScreen() {
  const { refreshAll, paths, places, stations } = useData();
  const { prefs, setPrefs } = usePrefs();
  const auth = useAuth();
  const { logs } = useRideLog();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [openGuide, setOpenGuide] = useState<number | null>(null);

  const refresh = async () => {
    setBusy(true);
    await refreshAll();
    setBusy(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <HorizontalLogo height={46} />
        <Text style={styles.heroTag}>{TAGLINE}</Text>
      </View>
      <Text style={styles.p}>
        Bike paths, live BCycle e-bikes, bike shops, fix-it stations and parking for Madison and nearby
        communities, in one free app.
      </Text>

      {auth.configured && (
        <>
          <Text style={styles.h2}>Account</Text>
          {auth.session ? (
            <View style={styles.accountBox}>
              <Text style={styles.prefsText}>{auth.profile?.full_name || 'Rider'}</Text>
              <Text style={styles.prefsHint}>{auth.session.user.email}</Text>
              <View style={styles.accountActions}>
                <Text style={styles.link} onPress={() => auth.openSheet('profile')}>Edit profile</Text>
                <Text style={styles.link} onPress={() => void auth.signOut()}>Sign out</Text>
                <Text
                  style={[styles.link, { color: '#b91c1c' }]}
                  onPress={() =>
                    Alert.alert(
                      'Delete your account?',
                      'This permanently deletes your profile and saved rides. It cannot be undone.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () =>
                            void auth.deleteAccount().catch((e: unknown) =>
                              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.'),
                            ),
                        },
                      ],
                    )
                  }>
                  Delete account
                </Text>
              </View>
            </View>
          ) : (
            <Pressable style={styles.signInBtn} onPress={() => auth.openSheet('gate')} accessibilityRole="button">
              <Text style={styles.buttonText}>Sign in or create a free account</Text>
            </Pressable>
          )}
        </>
      )}

      <Text style={styles.h2}>Your stats</Text>
      {auth.session || !auth.configured ? (
        <RideStats logs={logs} />
      ) : (
        <Pressable style={styles.statsTeaser} onPress={() => auth.openSheet('gate')} accessibilityRole="button">
          <Text style={styles.prefsText}>Track your miles and earn badges</Text>
          <Text style={styles.prefsHint}>
            {logs.length
              ? `${logs.length} ${logs.length === 1 ? 'ride' : 'rides'} saved on this phone. Create a free account to keep them and see your stats.`
              : 'Create a free account to see miles, average speed and badges for every ride.'}
          </Text>
        </Pressable>
      )}

      <Text style={styles.h2}>Your riding</Text>
      <Pressable style={styles.prefsRow} onPress={() => setEditing(true)} accessibilityRole="button">
        <View style={{ flex: 1 }}>
          <Text style={styles.prefsText}>
            {prefs
              ? `${BIKE_OPTIONS.find((b) => b.id === prefs.bike)?.label} · ${COMFORT_OPTIONS.find((c) => c.id === prefs.comfort)?.label}`
              : 'Not set yet'}
          </Text>
          <Text style={styles.prefsHint}>Sets your default route style</Text>
        </View>
        <Text style={styles.link}>Change</Text>
      </Pressable>

      <Text style={styles.h2}>Rider guides</Text>
      {GUIDES.map((g, i) => (
        <View key={g.title} style={styles.guide}>
          <Pressable
            style={styles.guideHead}
            onPress={() => setOpenGuide(openGuide === i ? null : i)}
            accessibilityRole="button"
            accessibilityState={{ expanded: openGuide === i }}>
            <Text style={styles.guideTitle}>{g.title}</Text>
            <Ionicons name={openGuide === i ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.muted} />
          </Pressable>
          {openGuide === i && (
            <View style={{ paddingBottom: 12 }}>
              <Text style={styles.p}>{g.body}</Text>
              {g.link && (
                <Text style={[styles.link, { marginTop: 8 }]} onPress={() => Linking.openURL(g.link!.url)}>
                  {g.link.label}
                </Text>
              )}
            </View>
          )}
        </View>
      ))}

      <Text style={styles.h2}>Map key</Text>
      {Object.entries(PATH_META).map(([k, m]) => (
        <View key={k} style={styles.legendRow}>
          <View style={[styles.line, { backgroundColor: m.color }, k === 'path_unpaved' && styles.dashed]} />
          <Text style={styles.legendText}>{m.label}</Text>
        </View>
      ))}
      <View style={styles.legendRow}>
        <View style={[styles.dot, { backgroundColor: COLORS.bcycle }]} />
        <Text style={styles.legendText}>BCycle station (grey = no bikes right now)</Text>
      </View>
      {Object.entries(PLACE_META).map(([k, m]) => (
        <View key={k} style={styles.legendRow}>
          <View style={[styles.dot, { backgroundColor: m.color }]} />
          <Text style={styles.legendText}>{m.label}</Text>
        </View>
      ))}

      <Text style={styles.h2}>Data</Text>
      <Text style={styles.p}>
        Loaded: {paths.length.toLocaleString()} path segments, {places.length.toLocaleString()} places,{' '}
        {stations.length} BCycle stations. Paths and places are saved on your phone for offline use and refresh weekly.
      </Text>
      <Pressable style={styles.button} onPress={refresh} disabled={busy} accessibilityRole="button">
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Refresh map data now</Text>}
      </Pressable>

      <Text style={styles.h2}>Sources</Text>
      <Text style={styles.p}>
        Map data ©{' '}
        <Text style={styles.link} onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright')}>
          OpenStreetMap contributors
        </Text>{' '}
        (ODbL). Live station data from Madison BCycle&apos;s public GBFS feed. Ride Madison is not affiliated with
        BCycle or the City of Madison. Always follow posted signs and trail rules.
      </Text>

      <Onboarding
        key={editing ? 'open' : 'closed'}
        visible={editing}
        initial={prefs}
        onDone={(p) => {
          setPrefs(p);
          setEditing(false);
          if (auth.session) void auth.updateProfile({ bike_type: p.bike, comfort: p.comfort }).catch(() => {});
        }}
        onSkip={() => setEditing(false)}
      />

      <Text style={styles.version}>Version {Constants.expoConfig?.version ?? '0.1.0'}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND.cream },
  content: { padding: 20, paddingBottom: 40 },
  hero: { backgroundColor: BRAND.navy, borderRadius: 20, padding: 20, gap: 10, marginBottom: 8 },
  heroTag: { color: BRAND.limestone, fontSize: 14, fontFamily: FONT.medium },
  h2: { fontSize: 18, fontFamily: FONT.black, color: COLORS.text, marginTop: 24, marginBottom: 8 },
  p: { fontSize: 15, lineHeight: 22, color: COLORS.text, marginTop: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  line: { width: 28, height: 4, borderRadius: 2 },
  dashed: { opacity: 0.7 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  legendText: { fontSize: 14, color: COLORS.text, flex: 1 },
  button: {
    marginTop: 12, backgroundColor: COLORS.brand, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 15, fontFamily: FONT.black },
  link: { color: COLORS.brand, textDecorationLine: 'underline', fontWeight: '600' },
  accountBox: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14, backgroundColor: '#fff' },
  accountActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 12 },
  statsTeaser: { backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 4 },
  signInBtn: { backgroundColor: COLORS.brand, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  prefsRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14,
    backgroundColor: '#fff',
  },
  prefsText: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.text },
  prefsHint: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  guide: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  guideHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  guideTitle: { fontSize: 16, fontFamily: FONT.bold, color: COLORS.text, flex: 1 },
  version: { marginTop: 28, fontSize: 12, color: COLORS.muted, textAlign: 'center' },
});
