// Short onboarding: what do you ride (plus e-bike class), and how comfortable
// are you in traffic. Answers set route defaults; changeable later under More
// (mode="edit": "Your riding" with Save / Cancel).

import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon, Wordmark } from '@/components/brand';
import { FONT } from '@/lib/config';
import { useT } from '@/lib/i18n';
import {
  BIKE_OPTIONS, COMFORT_OPTIONS, EBIKE_CLASS_OPTIONS, buildPrefs, prefsComplete, type BikeType, type Comfort, type EbikeClass,
  type Prefs,
} from '@/lib/rider';
import { makeStyles, useTheme } from '@/lib/theme';

interface Props {
  visible: boolean;
  /** 'welcome' on first open; 'edit' when opened from More. */
  mode?: 'welcome' | 'edit';
  initial?: Prefs | null;
  onDone: (p: Prefs) => void;
  /** First open: "Skip for now". Edit: "Cancel". */
  onSkip?: () => void;
}

export function Onboarding({ visible, mode = 'welcome', initial, onDone, onSkip }: Props) {
  const editing = mode === 'edit';
  const [bike, setBike] = useState<BikeType | null>(initial?.bike ?? null);
  const [comfort, setComfort] = useState<Comfort | null>(initial?.comfort ?? null);
  const [ebikeClass, setEbikeClass] = useState<EbikeClass | null>(initial?.ebikeClass ?? null);
  const ready = prefsComplete(bike, comfort, ebikeClass);
  const { t } = useT();
  const { c } = useTheme();
  const styles = useStyles();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onSkip}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          {editing ? (
            <>
              <Text style={styles.welcome} accessibilityRole="header">{t('more.yourRiding')}</Text>
              <Text style={styles.sub}>{t('more.ob.editSub')}</Text>
            </>
          ) : (
            <>
              <AppIcon size={64} />
              <View style={styles.titleRow} accessible accessibilityRole="header" accessibilityLabel={t('more.ob.welcomeA11y')}>
                <Text style={styles.welcome}>{t('more.ob.welcomeTo')}</Text>
                <Wordmark size={28} color={c.text} />
              </View>
              <Text style={styles.sub}>{t('more.ob.welcomeSub')}</Text>
            </>
          )}

          <Text style={styles.q} accessibilityRole="header">{t('more.ob.whatRide')}</Text>
          <View style={styles.grid} accessibilityRole="radiogroup">
            {BIKE_OPTIONS.map((o) => (
              <Pressable
                key={o.id}
                onPress={() => setBike(o.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: bike === o.id }}
                style={[styles.tile, bike === o.id && styles.tileOn]}>
                <Ionicons name={o.icon as keyof typeof Ionicons.glyphMap} size={24} color={bike === o.id ? c.onPrimary : c.primary} />
                <Text style={[styles.tileText, bike === o.id && { color: c.onPrimary }]}>{t(o.labelKey)}</Text>
              </Pressable>
            ))}
          </View>

          {bike === 'ebike' && (
            <>
              <Text style={styles.q} accessibilityRole="header">{t('more.ob.whichClass')}</Text>
              <Text style={styles.hint}>{t('more.ob.classHint')}</Text>
              <View style={styles.grid} accessibilityRole="radiogroup">
                {EBIKE_CLASS_OPTIONS.map((o) => (
                  <Pressable
                    key={o.id}
                    onPress={() => setEbikeClass(o.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: ebikeClass === o.id }}
                    accessibilityHint={t(o.detailKey)}
                    style={[styles.classChip, ebikeClass === o.id && styles.tileOn]}>
                    <Text style={[styles.tileText, ebikeClass === o.id && { color: c.onPrimary }]}>{t(o.labelKey)}</Text>
                    <Text style={[styles.chipDetail, ebikeClass === o.id && { color: c.onPrimary }]}>{t(o.detailKey)}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={styles.q} accessibilityRole="header">{t('more.ob.comfortQ')}</Text>
          <View accessibilityRole="radiogroup">
            {COMFORT_OPTIONS.map((o) => (
              <Pressable
                key={o.id}
                onPress={() => setComfort(o.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: comfort === o.id }}
                style={[styles.option, comfort === o.id && styles.optionOn]}>
                <Ionicons
                  name={comfort === o.id ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={comfort === o.id ? c.primary : c.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>{t(o.labelKey)}</Text>
                  <Text style={styles.optionDetail}>{t(o.detailKey)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            disabled={!ready}
            onPress={() => {
              if (bike && comfort && ready) onDone(buildPrefs(bike, comfort, ebikeClass));
            }}
            style={[styles.cta, !ready && { opacity: 0.4 }]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready }}>
            <Text style={styles.ctaText}>{editing ? t('common.save') : t('more.ob.start')}</Text>
          </Pressable>
          {onSkip && (
            <Pressable onPress={onSkip} style={styles.skipBtn} accessibilityRole="button">
              <Text style={styles.skip}>{editing ? t('common.cancel') : t('more.ob.skip')}</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.bg },
  content: { padding: 24, paddingBottom: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 16 },
  welcome: { fontSize: 28, fontFamily: FONT.black, color: c.text },
  sub: { fontSize: 16, color: c.textMuted, marginTop: 6 },
  q: { fontSize: 19, fontFamily: FONT.black, color: c.text, marginTop: 28, marginBottom: 12 },
  hint: { fontSize: 14, color: c.textMuted, marginTop: -6, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%', flexGrow: 1, minHeight: 72, borderWidth: 1.5, borderColor: c.border, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  classChip: {
    width: '48%', flexGrow: 1, minHeight: 56, borderWidth: 1.5, borderColor: c.border, borderRadius: 14,
    paddingVertical: 10, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  tileOn: { backgroundColor: c.primary, borderColor: c.primary },
  tileText: { fontSize: 15, fontFamily: FONT.bold, color: c.text, textAlign: 'center' },
  chipDetail: { fontSize: 13, color: c.textMuted, textAlign: 'center' },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: c.border,
    borderRadius: 14, padding: 14, marginBottom: 10, minHeight: 56,
  },
  optionOn: { borderColor: c.primary, backgroundColor: c.surfaceAlt },
  optionTitle: { fontSize: 16, fontWeight: '600', color: c.text },
  optionDetail: { fontSize: 14, color: c.textMuted, marginTop: 2 },
  footer: { paddingHorizontal: 24, paddingBottom: 8, gap: 4 },
  cta: { backgroundColor: c.accent, borderRadius: 14, minHeight: 52, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: c.onAccent, fontSize: 17, fontFamily: FONT.black },
  skipBtn: { alignSelf: 'center', minHeight: 44, minWidth: 120, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  skip: { color: c.text, fontSize: 16, fontWeight: '600' },
}));
