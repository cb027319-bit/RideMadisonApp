// Branded opening screen: picks up seamlessly from the navy native splash,
// animates in the logo, RideMadison™ wordmark and tagline, then fades into the
// app. Tap anywhere to skip.

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LogoMark, Wordmark } from '@/components/brand';
import { BRAND, FONT } from '@/lib/config';

export const TAGLINE = 'The free local riding guide for Greater Madison';
const HOLD_MS = 1400;

export function LaunchScreen({ onDone }: { onDone: () => void }) {
  const [mark] = useState(() => new Animated.Value(0));
  const [text] = useState(() => new Animated.Value(0));
  const [out] = useState(() => new Animated.Value(1));
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    Animated.timing(out, { toValue: 0, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => onDone());
  };
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });

  useEffect(() => {
    Animated.sequence([
      Animated.spring(mark, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }),
      Animated.timing(text, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => finishRef.current(), HOLD_MS + 900);
    return () => clearTimeout(t);
  }, [mark, text]);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity: out }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => finishRef.current()} accessibilityLabel="Ride Madison. Tap to continue.">
        <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
          <View style={styles.middle}>
            <Animated.View
              style={{
                opacity: mark,
                transform: [
                  { scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                  { translateY: mark.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
                ],
              }}>
              <LogoMark size={128} color={BRAND.limestone} tm={false} />
            </Animated.View>
            <Animated.View
              style={{
                alignItems: 'center',
                opacity: text,
                transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
              }}>
              <Wordmark size={44} color="#FFFFFF" style={{ marginTop: 22 }} />
              <View style={styles.rule} />
              <Text style={styles.tagline}>{TAGLINE}</Text>
            </Animated.View>
          </View>
          <Animated.Text style={[styles.footer, { opacity: text }]}>Made in Madison, Wisconsin</Animated.Text>
        </SafeAreaView>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: BRAND.navy, zIndex: 1000, elevation: 1000 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'space-between' },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  rule: { width: 44, height: 3, borderRadius: 2, backgroundColor: BRAND.red, marginTop: 18, marginBottom: 16 },
  tagline: { color: BRAND.limestone, fontSize: 17, fontFamily: FONT.medium, textAlign: 'center', lineHeight: 24 },
  footer: { color: BRAND.gold, fontSize: 12, fontFamily: FONT.bold, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 18 },
});
