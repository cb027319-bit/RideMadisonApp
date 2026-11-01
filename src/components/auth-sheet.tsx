// Sign-up / sign-in sheet: Apple, Google, or an emailed 6-digit code, then a
// short, skippable profile step (optional name and phone, email opt-in).
// Shown on first open (skippable) and whenever an account-only feature needs it.

import Ionicons from '@expo/vector-icons/Ionicons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text,
  TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon, Wordmark } from '@/components/brand';
import { useAuth } from '@/lib/auth';
import { resendSecondsLeft } from '@/lib/auth-errors';
import { BRAND, COLORS, FONT } from '@/lib/config';
import { formatPhone, isValidEmail, normalizePhone } from '@/lib/contact';
import { usePrefs } from '@/lib/prefs';

type Step = 'choose' | 'code' | 'profile';

export function AuthSheet() {
  const auth = useAuth();
  const visible = auth.sheet != null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={auth.closeSheet}>
      {/* Remount per opening so fields start fresh. */}
      {visible && <SheetBody key={`${auth.sheet!.mode}:${auth.sheet!.reason ?? ''}`} />}
    </Modal>
  );
}

function SheetBody() {
  const auth = useAuth();
  const { prefs } = usePrefs();
  const mode = auth.sheet!.mode;
  const [step, setStep] = useState<Step>(mode === 'profile' ? 'profile' : 'choose');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const resendIn = resendSecondsLeft(codeSentAt, now);

  // Tick once a second while the resend cooldown runs.
  useEffect(() => {
    if (codeSentAt == null) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (resendSecondsLeft(codeSentAt, n) === 0) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [codeSentAt]);

  // Once signed in, the sign-in steps give way to the profile step.
  const current: Step = auth.session && step !== 'profile' ? 'profile' : step;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.topBar}>
          {current === 'code' ? (
            <Pressable
              onPress={() => {
                setError(null);
                setStep('choose');
              }}
              style={styles.topBtn}
              accessibilityRole="button"
              accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={26} color={COLORS.text} />
            </Pressable>
          ) : (
            <View />
          )}
          {current !== 'profile' && (
            <Pressable onPress={auth.closeSheet} style={styles.topBtn} accessibilityRole="button">
              <Text style={styles.later}>Not now</Text>
            </Pressable>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {current === 'choose' && (
            <>
              <View style={styles.logo}>
                <AppIcon size={72} />
              </View>
              {mode === 'welcome' ? (
                <View style={styles.titleRow} accessible accessibilityRole="header" accessibilityLabel="Join Ride Madison">
                  <Text style={styles.h1}>Join </Text>
                  <Wordmark size={30} />
                </View>
              ) : (
                <Text style={styles.h1} accessibilityRole="header">Create a free account</Text>
              )}
              <Text style={styles.sub}>
                {auth.sheet!.reason ?? 'Save your rides and stats and find them on any phone. Free, always.'}{' '}
                The map and directions always work without an account.
              </Text>

              <View style={styles.buttons}>
                {auth.appleAvailable && (
                  <View
                    style={[styles.appleWrap, !!busy && styles.disabled, { pointerEvents: busy ? 'none' : 'auto' }]}
                    accessibilityState={{ disabled: !!busy, busy: busy === 'apple' }}>
                    <AppleAuthentication.AppleAuthenticationButton
                      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                      cornerRadius={12}
                      style={styles.appleBtn}
                      onPress={() => {
                        if (!busy) void run('apple', auth.signInWithApple);
                      }}
                    />
                    {busy === 'apple' && <ActivityIndicator color="#fff" style={styles.appleSpinner} />}
                  </View>
                )}
                {auth.googleEnabled && (
                  <Pressable
                    style={({ pressed }) => [styles.providerBtn, pressed && styles.pressed, !!busy && busy !== 'google' && styles.disabled]}
                    onPress={() => void run('google', auth.signInWithGoogle)}
                    disabled={!!busy}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !!busy, busy: busy === 'google' }}>
                    {busy === 'google' ? <ActivityIndicator /> : <Ionicons name="logo-google" size={20} color="#ea4335" />}
                    <Text style={styles.providerText}>Continue with Google</Text>
                  </Pressable>
                )}

                {(auth.googleEnabled || auth.appleAvailable) && (
                  <View style={styles.divider}>
                    <View style={styles.rule} />
                    <Text style={styles.or}>or use email</Text>
                    <View style={styles.rule} />
                  </View>
                )}

                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={COLORS.muted}
                  style={styles.input}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  accessibilityLabel="Email address"
                  editable={!busy}
                />
                <Pressable
                  style={[styles.primaryBtn, (!isValidEmail(email) || !!busy) && styles.disabled]}
                  disabled={!isValidEmail(email) || !!busy}
                  onPress={() =>
                    void run('email', async () => {
                      await auth.sendEmailCode(email);
                      setCode('');
                      setCodeSentAt(Date.now());
                      setNow(Date.now());
                      setStep('code');
                    })
                  }
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !isValidEmail(email) || !!busy, busy: busy === 'email' }}>
                  {busy === 'email' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Email me a code</Text>}
                </Pressable>
              </View>
              {error && <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">{error}</Text>}
              {mode === 'welcome' && (
                <Pressable
                  style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
                  onPress={auth.closeSheet}
                  accessibilityRole="button">
                  <Text style={styles.secondaryText}>Just explore the map</Text>
                </Pressable>
              )}
              <Text style={styles.legal}>
                By continuing you agree to the{' '}
                <Text style={styles.link} accessibilityRole="link" onPress={() => Linking.openURL('https://ridemadison.com/terms')}>Terms</Text> and{' '}
                <Text style={styles.link} accessibilityRole="link" onPress={() => Linking.openURL('https://ridemadison.com/privacy')}>Privacy Policy</Text>.
              </Text>
            </>
          )}

          {current === 'code' && (
            <>
              <Text style={styles.h1} accessibilityRole="header">Check your email</Text>
              <Text style={styles.sub}>Enter the 6-digit code we sent to {email.trim()}.</Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                placeholderTextColor={COLORS.muted}
                style={[styles.input, styles.codeInput]}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                autoFocus
                accessibilityLabel="6-digit code"
              />
              <Pressable
                style={[styles.primaryBtn, (code.length !== 6 || !!busy) && styles.disabled]}
                disabled={code.length !== 6 || !!busy}
                onPress={() => void run('verify', () => auth.verifyEmailCode(email, code))}
                accessibilityRole="button"
                accessibilityState={{ disabled: code.length !== 6 || !!busy, busy: busy === 'verify' }}>
                {busy === 'verify' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Continue</Text>}
              </Pressable>
              {error && <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">{error}</Text>}
              <Pressable
                onPress={() =>
                  void run('resend', async () => {
                    await auth.sendEmailCode(email);
                    setCodeSentAt(Date.now());
                    setNow(Date.now());
                  })
                }
                disabled={!!busy || resendIn > 0}
                style={styles.resendBtn}
                accessibilityRole="button"
                accessibilityState={{ disabled: !!busy || resendIn > 0, busy: busy === 'resend' }}>
                <Text style={[styles.linkCenter, (!!busy || resendIn > 0) && { color: COLORS.muted }]}>
                  {busy === 'resend' ? 'Sending…' : resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
                </Text>
              </Pressable>
            </>
          )}

          {current === 'profile' && <ProfileStep prefsBike={prefs?.bike} prefsComfort={prefs?.comfort} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ProfileStep({ prefsBike, prefsComfort }: { prefsBike?: string; prefsComfort?: string }) {
  const auth = useAuth();
  const meta = auth.session?.user.user_metadata as { full_name?: string; name?: string } | undefined;
  const [name, setName] = useState(auth.profile?.full_name ?? meta?.full_name ?? meta?.name ?? '');
  const [phone, setPhone] = useState(formatPhone(auth.profile?.phone ?? null));
  const [emailOptIn, setEmailOptIn] = useState(auth.profile?.email_opt_in ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = auth.session?.user.email ?? auth.profile?.email ?? '';
  const hiddenAppleEmail = email.endsWith('@privaterelay.appleid.com');
  const phoneE164 = phone.trim() ? normalizePhone(phone) : null;
  const phoneInvalid = phone.trim().length > 0 && !phoneE164;

  const save = async () => {
    if (phoneInvalid) {
      setError('That phone number doesn’t look right.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.updateProfile({
        full_name: name.trim() || null,
        phone: phoneE164,
        // Texts aren't offered yet: turn off any old consent when the number is removed.
        ...(phoneE164 ? {} : { sms_opt_in: false }),
        email_opt_in: emailOptIn,
        ...(prefsBike ? { bike_type: prefsBike } : {}),
        ...(prefsComfort ? { comfort: prefsComfort } : {}),
      });
      auth.closeSheet();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text style={styles.h1} accessibilityRole="header">{auth.sheet?.mode === 'profile' ? 'Your profile' : 'You’re in! One last step'}</Text>
      <Text style={styles.sub}>{email ? `Signed in as ${hiddenAppleEmail ? 'your private Apple email' : email}` : ''}</Text>

      <Text style={styles.label}>Name <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="What should we call you?"
        placeholderTextColor={COLORS.muted}
        style={styles.input}
        autoComplete="name"
        textContentType="name"
        accessibilityLabel="Name, optional"
      />

      <Text style={styles.label}>Mobile phone <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="(608) 555-0123"
        placeholderTextColor={COLORS.muted}
        style={[styles.input, phoneInvalid && { borderColor: '#dc2626' }]}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        accessibilityLabel="Mobile phone, optional"
      />

      <View style={styles.optRow}>
        <Switch
          value={emailOptIn}
          onValueChange={setEmailOptIn}
          trackColor={{ true: COLORS.brand }}
          accessibilityLabel="Email me news and offers"
        />
        <Text style={styles.optText} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          Email me Ride Madison news, events and local rider offers.
        </Text>
      </View>

      {error && <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">{error}</Text>}
      <Pressable
        style={[styles.primaryBtn, busy && styles.disabled, { marginTop: 18 }]}
        disabled={busy}
        onPress={() => void save()}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy }}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save</Text>}
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
        disabled={busy}
        onPress={auth.closeSheet}
        accessibilityRole="button">
        <Text style={styles.secondaryText}>{auth.sheet?.mode === 'profile' ? 'Cancel' : 'Skip'}</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 4, minHeight: 48 },
  topBtn: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  later: { fontSize: 16, color: COLORS.text, fontWeight: '600' },
  content: { padding: 24, paddingTop: 8 },
  logo: { marginBottom: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  h1: { fontSize: 28, fontFamily: FONT.black, color: COLORS.text },
  sub: { fontSize: 16, color: COLORS.muted, marginTop: 8, lineHeight: 22 },
  buttons: { marginTop: 28, gap: 12 },
  appleWrap: { justifyContent: 'center' },
  appleBtn: { height: 50, width: '100%' },
  appleSpinner: { position: 'absolute', right: 16 },
  providerBtn: {
    minHeight: 50, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  providerText: { fontSize: 17, fontFamily: FONT.bold, color: COLORS.text },
  pressed: { backgroundColor: '#f3f4f6' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
  or: { color: COLORS.muted, fontSize: 14 },
  label: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.text, marginTop: 20, marginBottom: 6 },
  optional: { fontWeight: '400', color: COLORS.muted },
  input: {
    minHeight: 50, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: COLORS.text,
  },
  codeInput: { marginTop: 24, fontSize: 28, letterSpacing: 10, textAlign: 'center', minHeight: 60, marginBottom: 12 },
  primaryBtn: { minHeight: 50, borderRadius: 12, backgroundColor: COLORS.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontFamily: FONT.black },
  secondaryBtn: {
    minHeight: 50, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.brand, alignItems: 'center', justifyContent: 'center',
    marginTop: 12, paddingHorizontal: 16, paddingVertical: 10,
  },
  secondaryText: { color: COLORS.brand, fontSize: 17, fontFamily: FONT.bold, textAlign: 'center' },
  resendBtn: { marginTop: 12, minHeight: 44, justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  error: { color: BRAND.red, fontSize: 14, marginTop: 12, fontWeight: '600' },
  legal: { fontSize: 13, color: COLORS.muted, marginTop: 20, lineHeight: 18 },
  link: { color: COLORS.brand, textDecorationLine: 'underline' },
  linkCenter: { color: COLORS.brand, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  optText: { flex: 1, fontSize: 14, color: COLORS.text, lineHeight: 19 },
});
