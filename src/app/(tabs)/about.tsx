import Constants from 'expo-constants';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/lib/config';
import { useData } from '@/lib/data';
import { PATH_META, PLACE_META } from '@/lib/labels';

export default function AboutScreen() {
  const { refreshAll, paths, places, stations } = useData();
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    await refreshAll();
    setBusy(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Ride Madison</Text>
      <Text style={styles.p}>
        Bike paths, live BCycle e-bikes, bike shops, fix-it stations and parking for Madison and nearby
        communities, in one free app.
      </Text>

      <Text style={styles.h2}>Map key</Text>
      {Object.entries(PATH_META).map(([k, m]) => (
        <View key={k} style={styles.legendRow}>
          <View style={[styles.line, { backgroundColor: m.color }, k === 'path_unpaved' && styles.dashed]} />
          <Text style={styles.legendText}>{m.label}</Text>
        </View>
      ))}
      <View style={styles.legendRow}>
        <View style={[styles.dot, { backgroundColor: COLORS.bcycle }]} />
        <Text style={styles.legendText}>BCycle station (number = bikes available, grey = none)</Text>
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

      <Text style={styles.version}>Version {Constants.expoConfig?.version ?? '0.1.0'}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 20, paddingBottom: 40 },
  h1: { fontSize: 26, fontWeight: '800', color: COLORS.brandDark },
  h2: { fontSize: 17, fontWeight: '700', color: COLORS.text, marginTop: 24, marginBottom: 8 },
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
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  link: { color: COLORS.brand, textDecorationLine: 'underline' },
  version: { marginTop: 28, fontSize: 12, color: COLORS.muted, textAlign: 'center' },
});
