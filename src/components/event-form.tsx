// "Add an event" form: riders and businesses submit events, which appear after Ride Madison approves them.
// Date and time are picked from chips (no native date picker needed).
// Mount it only while open, so each visit starts with an empty form.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';

import { FONT } from '@/lib/config';
import { useData } from '@/lib/data';
import { CATEGORY_ICON, EVENT_CATEGORIES, validateSubmission, type EventCategory } from '@/lib/events';
import { submitEvent } from '@/lib/events-api';
import { lang, useT } from '@/lib/i18n';
import { searchPlaces, type PlaceResult } from '@/lib/routing';
import { makeStyles, useTheme } from '@/lib/theme';

const DAYS_AHEAD = 90;
/** 6:00 AM … 11:30 PM every 30 minutes, as minutes after midnight. */
const TIMES = Array.from({ length: 36 }, (_, i) => 6 * 60 + i * 30);
const LENGTHS = [1, 2, 3, 4] as const;
type Length = (typeof LENGTHS)[number] | 'allDay';

const loc = () => (lang() === 'es' ? 'es-US' : 'en-US');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function EventForm({ visible, email, onClose }: { visible: boolean; email: string | null; onClose: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const styles = useStyles();
  const { location } = useData();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<EventCategory>('bike');
  const [day, setDay] = useState<Date | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [length, setLength] = useState<Length>(2);
  const [venue, setVenue] = useState<PlaceResult | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [url, setUrl] = useState('');
  const [about, setAbout] = useState('');
  const [contact, setContact] = useState(email ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const days = useMemo(() => {
    const today = startOfDay(new Date());
    return Array.from({ length: DAYS_AHEAD }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  }, []);

  // Search places as the rider types (debounced).
  const searchable = !venue && query.trim().length >= 3;
  const shown = searchable ? results : [];
  useEffect(() => {
    if (!searchable) return;
    const timer = setTimeout(async () => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setSearching(true);
      setSearchError(false);
      try {
        const near = location ? { latitude: location.latitude, longitude: location.longitude } : null;
        setResults(await searchPlaces(query.trim(), near, ctrl.signal));
      } catch {
        if (!ctrl.signal.aborted) setSearchError(true);
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query, searchable, location]);

  const build = () => {
    if (!day) return { startsAt: undefined, endsAt: null };
    if (length === 'allDay') {
      const s = startOfDay(day);
      return { startsAt: s, endsAt: new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1) };
    }
    if (minutes == null) return { startsAt: undefined, endsAt: null };
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
    return { startsAt: s, endsAt: new Date(s.getTime() + length * 3_600_000) };
  };

  const send = async () => {
    const { startsAt, endsAt } = build();
    const draft = {
      title,
      category,
      startsAt,
      endsAt,
      venueName: venue?.title,
      address: venue?.subtitle ?? null,
      latitude: venue?.latitude,
      longitude: venue?.longitude,
      url: url.trim() || null,
    };
    const errs = validateSubmission(draft);
    setErrors(errs);
    if (errs.length) return;
    setSending(true);
    try {
      await submitEvent({
        ...draft,
        startsAt: startsAt!,
        venueName: venue!.title,
        latitude: venue!.latitude,
        longitude: venue!.longitude,
        description: about.trim() || null,
        contactEmail: contact.trim() || null,
      });
      onClose();
      Alert.alert(t('events.form.thanksTitle'), t('events.form.thanks'));
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    } finally {
      setSending(false);
    }
  };

  const timeText = (m: number) =>
    new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString(loc(), { hour: 'numeric', minute: m % 60 ? '2-digit' : undefined });
  const errorText = (e: string) => (e.startsWith('events.err.') ? t(e) : e);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={styles.headerBtn}>
            <Text style={styles.cancel}>{t('common.cancel')}</Text>
          </Pressable>
          <Text style={styles.headerTitle} accessibilityRole="header">
            {t('events.form.title')}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>{t('events.form.name')}</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={t('events.form.namePh')}
            placeholderTextColor={c.textFaint}
            maxLength={120}
            accessibilityLabel={t('events.form.name')}
          />

          <Text style={styles.label}>{t('events.form.category')}</Text>
          <View style={styles.wrap}>
            {EVENT_CATEGORIES.map((cat) => (
              <Chip key={cat} on={category === cat} onPress={() => setCategory(cat)} icon={CATEGORY_ICON[cat]} text={t(`events.cat.${cat}`)} />
            ))}
          </View>

          <Text style={styles.label}>{t('events.form.date')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {days.map((d) => (
              <Chip
                key={d.toISOString()}
                on={!!day && d.getTime() === day.getTime()}
                onPress={() => setDay(d)}
                text={d.toLocaleDateString(loc(), { weekday: 'short', month: 'short', day: 'numeric' })}
              />
            ))}
          </ScrollView>

          <Text style={styles.label}>{t('events.form.length')}</Text>
          <View style={styles.wrap}>
            {LENGTHS.map((h) => (
              <Chip key={h} on={length === h} onPress={() => setLength(h)} text={t('events.form.hours', { n: h })} />
            ))}
            <Chip on={length === 'allDay'} onPress={() => setLength('allDay')} text={t('events.form.allDay')} />
          </View>

          {length !== 'allDay' && (
            <>
              <Text style={styles.label}>{t('events.form.time')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {TIMES.map((m) => (
                  <Chip key={m} on={minutes === m} onPress={() => setMinutes(m)} text={timeText(m)} />
                ))}
              </ScrollView>
            </>
          )}

          <Text style={styles.label}>{t('events.form.venue')}</Text>
          {venue ? (
            <View style={styles.venueBox}>
              <Ionicons name="location" size={20} color={c.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.venueTitle}>{venue.title}</Text>
                {venue.subtitle ? <Text style={styles.venueSub}>{venue.subtitle}</Text> : null}
              </View>
              <Pressable onPress={() => setVenue(null)} hitSlop={8} accessibilityRole="button" style={styles.headerBtn}>
                <Text style={styles.change}>{t('events.form.venueChange')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={query}
                onChangeText={setQuery}
                placeholder={t('events.form.venuePh')}
                placeholderTextColor={c.textFaint}
                autoCorrect={false}
                accessibilityLabel={t('events.form.venue')}
              />
              {searchable && searching ? (
                <View style={styles.searchNote}>
                  <ActivityIndicator size="small" color={c.primary} />
                  <Text style={styles.hint}>{t('events.form.searching')}</Text>
                </View>
              ) : searchable && searchError ? (
                <Text style={styles.hint}>{t('events.err.search')}</Text>
              ) : searchable && shown.length === 0 ? (
                <Text style={styles.hint}>{t('events.form.noResults')}</Text>
              ) : null}
              {shown.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => {
                    setVenue(r);
                  }}
                  style={({ pressed }) => [styles.result, pressed && { backgroundColor: c.pressed }]}
                  accessibilityRole="button">
                  <Ionicons name="location-outline" size={18} color={c.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.venueTitle} numberOfLines={1}>{r.title}</Text>
                    {r.subtitle ? <Text style={styles.venueSub} numberOfLines={1}>{r.subtitle}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </>
          )}

          <Text style={styles.label}>{t('events.form.link')}</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://"
            placeholderTextColor={c.textFaint}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('events.form.link')}
          />

          <Text style={styles.label}>{t('events.form.about')}</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={about}
            onChangeText={setAbout}
            placeholder={t('events.form.aboutPh')}
            placeholderTextColor={c.textFaint}
            multiline
            maxLength={1000}
            accessibilityLabel={t('events.form.about')}
          />

          <Text style={styles.label}>{t('events.form.email')}</Text>
          <TextInput
            style={styles.input}
            value={contact}
            onChangeText={setContact}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('events.form.email')}
          />
          <Text style={styles.hint}>{t('events.form.emailHint')}</Text>

          {errors.length > 0 && (
            <View style={styles.errorBox} accessibilityLiveRegion="polite">
              {errors.map((e) => (
                <Text key={e} style={styles.errorText}>• {errorText(e)}</Text>
              ))}
            </View>
          )}

          <Pressable
            onPress={send}
            disabled={sending}
            style={({ pressed }) => [styles.submit, (pressed || sending) && { opacity: 0.85 }]}
            accessibilityRole="button">
            {sending ? <ActivityIndicator color={c.onAccent} /> : <Ionicons name="send" size={18} color={c.onAccent} />}
            <Text style={styles.submitText}>{sending ? t('events.form.sending') : t('events.form.submit')}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Chip({ on, onPress, text, icon }: { on: boolean; onPress: () => void; text: string; icon?: string }) {
  const { c } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on && styles.chipOn]}>
      {icon ? <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={15} color={on ? c.onPrimary : c.textFaint} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{text}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  sheet: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8 },
  headerBtn: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontFamily: FONT.black, color: c.text },
  cancel: { fontSize: 16, color: c.primary },
  body: { padding: 16, gap: 8, paddingBottom: 48 },
  label: { fontSize: 14, fontFamily: FONT.bold, color: c.text, marginTop: 10 },
  input: {
    minHeight: 48, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: c.text, backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.border,
  },
  multiline: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { gap: 8, paddingRight: 16 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, backgroundColor: c.surfaceAlt,
  },
  chipOn: { backgroundColor: c.primary },
  chipText: { fontSize: 14, fontFamily: FONT.bold, color: c.textFaint },
  chipTextOn: { color: c.onPrimary },
  venueBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.border,
  },
  venueTitle: { fontSize: 15, fontFamily: FONT.bold, color: c.text },
  venueSub: { fontSize: 13, color: c.textMuted, marginTop: 1 },
  change: { fontSize: 15, fontFamily: FONT.bold, color: c.primary, textAlign: 'right' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 8, borderRadius: 10 },
  searchNote: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hint: { fontSize: 13, color: c.textMuted },
  errorBox: { padding: 12, borderRadius: 12, backgroundColor: c.surfaceAlt, gap: 4, marginTop: 8 },
  errorText: { fontSize: 14, color: c.danger },
  submit: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, borderRadius: 14,
    backgroundColor: c.accent, marginTop: 16,
  },
  submitText: { fontSize: 17, fontFamily: FONT.bold, color: c.onAccent },
}));
