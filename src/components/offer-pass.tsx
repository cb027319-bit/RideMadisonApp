// Full-screen rider offer pass: shown at the counter. The live clock proves it isn't a screenshot.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LogoMark } from '@/components/brand';
import { BRAND, FONT } from '@/lib/config';
import { locale, useT } from '@/lib/i18n';
import type { Partner } from '@/lib/partners';
import { makeStyles } from '@/lib/theme';

export function OfferPass({ partner, visible, onClose }: { partner: Partner; visible: boolean; onClose: () => void }) {
  const { t } = useT();
  const styles = useStyles();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [visible]);

  const time = now.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.top}>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel={t('map.offer.close')}>
            <Ionicons name="close" size={28} color={BRAND.limestone} />
          </Pressable>
        </View>
        <View style={styles.body}>
          <LogoMark size={56} color={BRAND.limestone} />
          <Text style={styles.kicker}>{t('map.offer.kicker')}</Text>
          <Text style={styles.name} accessibilityRole="header">{partner.name}</Text>
          <View style={styles.card}>
            <Text style={styles.offer}>{partner.offer}</Text>
            {partner.offer_code ? (
              <View style={styles.codeBox} accessibilityLabel={t('map.offer.codeA11y', { code: partner.offer_code.split('').join(' ') })}>
                <Text style={styles.codeLabel}>{t('map.offer.code')}</Text>
                <Text style={styles.code} selectable>{partner.offer_code}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.clock} accessibilityLiveRegion="none">{time}</Text>
          <Text style={styles.date}>{date}</Text>
          <Text style={styles.help}>{t('map.offer.help')}{partner.demo ? ` ${t('map.offer.sample')}` : ''}</Text>
        </View>
        <Pressable onPress={onClose} style={styles.done} accessibilityRole="button">
          <Text style={styles.doneText}>{t('common.done')}</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

// The pass stays navy in both modes (brand screen); the offer card follows the theme.
const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: BRAND.navy },
  top: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 10 },
  kicker: { fontSize: 14, fontFamily: FONT.bold, color: BRAND.gold, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8 },
  name: { fontSize: 30, fontFamily: FONT.black, color: '#fff', textAlign: 'center' },
  card: { alignSelf: 'stretch', backgroundColor: c.dark ? c.surfaceAlt : c.bg, borderRadius: 20, padding: 20, gap: 14, marginTop: 8 },
  offer: { fontSize: 22, fontFamily: FONT.bold, color: c.text, textAlign: 'center' },
  codeBox: { alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, paddingVertical: 10, borderWidth: 2, borderColor: BRAND.gold, borderStyle: 'dashed' },
  codeLabel: { fontSize: 13, fontFamily: FONT.bold, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  code: { fontSize: 32, fontFamily: FONT.black, color: c.text, letterSpacing: 3 },
  clock: { fontSize: 44, fontFamily: FONT.black, color: '#fff', marginTop: 12, fontVariant: ['tabular-nums'] },
  date: { fontSize: 18, fontFamily: FONT.medium, color: BRAND.limestone },
  help: { fontSize: 16, color: BRAND.limestone, marginTop: 6, textAlign: 'center' },
  done: { margin: 20, minHeight: 56, borderRadius: 28, backgroundColor: BRAND.gold, alignItems: 'center', justifyContent: 'center' },
  doneText: { fontSize: 18, fontFamily: FONT.black, color: BRAND.navy },
}));
