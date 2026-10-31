// Sign-up / sign-in sheet: Apple, Google, or an emailed 6-digit code, then a
// short profile step (name, optional phone, opt-ins). Shown on first open
// (skippable) and whenever an account-only feature needs it.

import Ionicons from '@expo/vector-icons/Ionicons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text,
  TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';
import { COLORS } from '@/lib/config';
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
            <Pressable onPress={() => setStep('choose')} hitSlop={10} accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={26} color={COLORS.text} />
            </Pressable>
          ) : (
            <View />
          )}
          {current !== 'profile' && (
            <Pressable onPress={auth.closeSheet} hitSlop={10} accessibilityRole="button">
              <Text style={styles.later}>{mode === 'welcome' ? 'Maybe later' : 'Not now'}</Text>
            </Pressable>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {current === 'choose' && (
            <>
              <View style={styles.logo}>
                <Ionicons name="bicycle" size={34} color="#fff" />
              </View>
              <Text style={styles.h1}>{mode === 'welcome' ? 'Join Ride Madison' : 'Create a free account'}</Text>
              <Text style={styles.sub}>
                {auth.sheet!.reason ??
                  'Save your rides, get alerts when your trails close, and report hazards for other riders. Free, always.'}
              </Text>

              <View style={styles.buttons}>
                {auth.appleAvailable && (
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={12}
                    style={styles.appleBtn}
                    onPress={() => void run('apple', auth.signInWithApple)}
                  />
                )}
                {auth.googleEnabled && (
                  <Pressable
                    style={({ pressed }) => [styles.providerBtn, pressed && styles.pressed]}
                    onPress={() => void run('google', auth.signInWithGoogle)}
                    disabled={!!busy}
                    accessibilityRole="button">
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
                />
                <Pressable
                  style={[styles.primaryBtn, (!isValidEmail(email) || !!busy) && styles.disabled]}
                  disabled={!isValidEmail(email) || !!busy}
                  onPress={() =>
                    void run('email', async () => {
                      await auth.sendEmailCode(email);
                      setCode('');
                      setStep('code');
                    })
                  }
                  accessibilityRole="button">
                  {busy === 'email' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Email me a code</Text>}
                </Pressable>
              </View>
              {error && <Text style={styles.error}>{error}</Text>}
              <Text style={styles.legal}>
                By continuing you agree to the{' '}
                <Text style={styles.link} onPress={() => Linking.openURL('https://ridemadison.com/terms')}>Terms</Text> and{' '}
                <Text style={styles.link} onPress={() => Linking.openURL('https://ridemadison.com/privacy')}>Privacy Policy</Text>.
                The map and directions always work without an account.
              </Text>
            </>
          )}

          {current === 'code' && (
            <>
              <Text style={styles.h1}>Check your email</Text>
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
                accessibilityRole="button">
                {busy === 'verify' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Continue</Text>}
              </Pressable>
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable onPress={() => void run('resend', () => auth.sendEmailCode(email))} style={{ marginTop: 16 }}>
                <Text style={styles.linkCenter}>{busy === 'resend' ? 'Sending…' : 'Send a new code'}</Text>
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
  const [smsOptIn, setSmsOptIn] = useState(auth.profile?.sms_opt_in ?? false);
  const [emailOptIn, setEmailOptIn] = useState(auth.profile?.email_opt_in ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = auth.session?.user.email ?? auth.profile?.email ?? '';
  const hiddenAppleEmail = email.endsWith('@privaterelay.appleid.com');
  const phoneE164 = phone.trim() ? normalizePhone(phone) : null;
  const phoneInvalid = phone.trim().length > 0 && !phoneE164;

  const save = async () => {
    if (!name.trim()) {
      setError('Please add your name.');
      return;
    }
    if (phoneInvalid) {
      setError('That phone number doesn’t look right.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.updateProfile({
        full_name: name.trim(),
        phone: phoneE164,
        sms_opt_in: !!phoneE164 && smsOptIn,
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
      <Text style={styles.h1}>{auth.sheet?.mode === 'profile' ? 'Your profile' : 'You’re in! One last step'}</Text>
      <Text style={styles.sub}>{email ? `Signed in as ${hiddenAppleEmail ? 'your private Apple email' : email}` : ''}</Text>

      <Text style={styles.label}>Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="First and last name"
        placeholderTextColor={COLORS.muted}
        style={styles.input}
        autoComplete="name"
        textContentType="name"
        accessibilityLabel="Name"
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
        <Switch value={!!phoneE164 && smsOptIn} onValueChange={setSmsOptIn} disabled={!phoneE164} trackColor={{ true: COLORS.brand }} />
        <Text style={[styles.optText, !phoneE164 && { color: COLORS.muted }]}>
          Text me trail closures and Ride Madison updates. Msg & data rates may apply; reply STOP to opt out.
        </Text>
      </View>
      <View style={styles.optRow}>
        <Switch value={emailOptIn} onValueChange={setEmailOptIn} trackColor={{ true: COLORS.brand }} />
        <Text style={styles.optText}>Email me Ride Madison news, events and local rider offers.</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={[styles.primaryBtn, busy && styles.disabled, { marginTop: 18 }]} disabled={busy} onPress={() => void save()}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save</Text>}
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, minHeight: 40 },
  later: { fontSize: 16, color: COLORS.muted, fontWeight: '600' },
  content: { padding: 24, paddingTop: 8 },
  logo: {
    width: 64, height: 64, borderRadius: 18, backgroundColor: COLORS.brand, alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  h1: { fontSize: 28, fontWeight: '800', color: COLORS.text },
  sub: { fontSize: 16, color: COLORS.muted, marginTop: 8, lineHeight: 22 },
  buttons: { marginTop: 28, gap: 12 },
  appleBtn: { height: 50, width: '100%' },
  providerBtn: {
    height: 50, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  providerText: { fontSize: 17, fontWeight: '600', color: COLORS.text },
  pressed: { backgroundColor: '#f3f4f6' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
  or: { color: COLORS.muted, fontSize: 13 },
  label: { fontSize: 14, fontWeight: '700', color: COLORS.text, marginTop: 20, marginBottom: 6 },
  optional: { fontWeight: '400', color: COLORS.muted },
  input: {
    height: 50, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: COLORS.text,
  },
  codeInput: { marginTop: 24, fontSize: 28, letterSpacing: 10, textAlign: 'center', height: 60, marginBottom: 12 },
  primaryBtn: { height: 50, borderRadius: 12, backgroundColor: COLORS.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  error: { color: '#b91c1c', fontSize: 14, marginTop: 12, fontWeight: '600' },
  legal: { fontSize: 12, color: COLORS.muted, marginTop: 24, lineHeight: 17 },
  link: { color: COLORS.brand, textDecorationLine: 'underline' },
  linkCenter: { color: COLORS.brand, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  optText: { flex: 1, fontSize: 14, color: COLORS.text, lineHeight: 19 },
});
