// "Add an event" form: riders and businesses submit events, which appear after Ride Madison approves them.
// Date, time and repeat length use steppers ("‹ Sat, Nov 14 ›") that VoiceOver adjusts with a swipe.
// Mount it only while open, so each visit starts with an empty form.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, findNodeHandle, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch,
  Text, TextInput, View, type AccessibilityActionEvent,
} from 'react-native';

import { FONT } from '@/lib/config';
import { useData } from '@/lib/data';
import {
  capitalize, CATEGORY_ICON, EVENT_CATEGORIES, MAX_SERIES_WEEKS, parsePrice, validateSubmission, weeklyDates,
  type EventCategory, type EventCost,
} from '@/lib/events';
import { submitEvent } from '@/lib/events-api';
import { locale, useT } from '@/lib/i18n';
import { searchPlaces, type PlaceResult } from '@/lib/routing';
import { makeStyles, useTheme } from '@/lib/theme';

/** How far ahead an event can be added. */
const DAYS_AHEAD = 180;
const TIME_STEP = 30;
const LAST_TIME = 24 * 60 - TIME_STEP;
const LENGTHS = [1, 2, 3, 4, 6] as const;
type Length = (typeof LENGTHS)[number];
const COSTS: EventCost[] = ['free', 'paid', 'unknown'];
const COST_KEY: Record<EventCost, string> = {
  free: 'events.form.costFree',
  paid: 'events.form.costPaid',
  unknown: 'events.form.costUnknown',
};

// Starting values (also used to tell whether anything was edited).
const START_DAY = 1; // tomorrow
const START_MINUTES = 18 * 60; // 6:00 PM
const START_LENGTH: Length = 2;
const START_WEEKS = 4;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const shortDate = (d: Date) => capitalize(d.toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' }));
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const announce = (s: string) => AccessibilityInfo.announceForAccessibility(s);

export function EventForm({ visible, email, onClose }: { visible: boolean; email: string | null; onClose: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const styles = useStyles();
  const { location } = useData();

  const [today] = useState(() => startOfDay(new Date()));
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<EventCategory>('bike');
  const [extras, setExtras] = useState<EventCategory[]>([]);
  const [dayOffset, setDayOffset] = useState(START_DAY);
  const [allDay, setAllDay] = useState(false);
  const [minutes, setMinutes] = useState(START_MINUTES);
  const [length, setLength] = useState<Length>(START_LENGTH);
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState(START_WEEKS);
  const [venue, setVenue] = useState<PlaceResult | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [cost, setCost] = useState<EventCost>('unknown');
  const [priceText, setPriceText] = useState('');
  const [url, setUrl] = useState('');
  const [about, setAbout] = useState('');
  const [contact, setContact] = useState(email ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const costRef = useRef<ComponentRef<typeof Text>>(null);

  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset);

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
        const found = await searchPlaces(query.trim(), near, ctrl.signal);
        setResults(found);
        announce(found.length ? t('events.form.results', { count: found.length }) : t('events.form.noResults'));
      } catch {
        if (!ctrl.signal.aborted) {
          setSearchError(true);
          announce(t('events.err.search'));
        }
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query, searchable, location, t]);

  const dirty =
    !!title.trim() || !!venue || !!query.trim() || !!url.trim() || !!about.trim() || contact !== (email ?? '') ||
    category !== 'bike' || extras.length > 0 || dayOffset !== START_DAY || allDay || minutes !== START_MINUTES ||
    length !== START_LENGTH || repeat || cost !== 'unknown' || !!priceText.trim();

  const requestClose = () => {
    if (!dirty || sending) {
      if (!sending) onClose();
      return;
    }
    Alert.alert(t('events.form.discardTitle'), t('events.form.discardBody'), [
      { text: t('events.form.keepEditing'), style: 'cancel' },
      { text: t('events.form.discard'), style: 'destructive', onPress: onClose },
    ]);
  };

  const build = () => {
    if (allDay) return { startsAt: day, endsAt: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) };
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
    return { startsAt: s, endsAt: new Date(s.getTime() + length * 3_600_000) };
  };

  const pickCategory = (cat: EventCategory) => {
    setCategory(cat);
    setExtras((x) => x.filter((e) => e !== cat));
  };
  const toggleExtra = (cat: EventCategory) => setExtras((x) => (x.includes(cat) ? x.filter((e) => e !== cat) : [...x, cat]));

  const pickPlace = (r: PlaceResult) => {
    setVenue(r);
    announce(t('events.form.placeSet', { name: r.title }));
    // Move VoiceOver on to the next field once the announcement has been read.
    setTimeout(() => {
      const node = findNodeHandle(costRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 1200);
  };

  const send = async () => {
    const { startsAt, endsAt } = build();
    const price = cost === 'paid' ? parsePrice(priceText) : null;
    const draft = {
      title,
      category,
      startsAt,
      endsAt,
      allDay,
      venueName: venue?.title,
      address: venue?.subtitle ?? null,
      latitude: venue?.latitude,
      longitude: venue?.longitude,
      url: url.trim() || null,
      cost,
      price,
      extraCategories: extras,
      weeks: repeat ? weeks : 1,
    };
    const errs = validateSubmission(draft);
    setErrors(errs);
    if (errs.length) {
      announce(errs.map((e) => t(e)).join(' '));
      return;
    }
    setSending(true);
    try {
      await submitEvent({
        ...draft,
        venueName: venue!.title,
        latitude: venue!.latitude,
        longitude: venue!.longitude,
        description: about.trim() || null,
        contactEmail: contact.trim() || null,
      });
      onClose();
      Alert.alert(t('events.form.thanksTitle'), t('events.form.thanks'));
    } catch (e) {
      // Only our own message keys are shown; anything else becomes a generic message.
      const key = e instanceof Error && e.message.startsWith('events.err.') ? e.message : 'events.err.generic';
      setErrors([key]);
      announce(t(key));
    } finally {
      setSending(false);
    }
  };

  const timeText = (m: number) =>
    new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
  const relDay = dayOffset === 0 ? t('events.today') : dayOffset === 1 ? t('events.tomorrow') : null;
  const dateText = relDay ? `${relDay} · ${shortDate(day)}` : shortDate(day);
  const lastDate = repeat ? weeklyDates(build().startsAt, weeks).at(-1) : undefined;
  const otherCategories = EVENT_CATEGORIES.filter((x) => x !== category).sort((a, b) =>
    // For bike events, suggest Family first (off by default).
    category === 'bike' ? Number(b === 'family') - Number(a === 'family') : 0,
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={requestClose}>
      <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={requestClose} hitSlop={10} accessibilityRole="button" style={styles.headerBtn}>
            <Text style={styles.cancel}>{t('common.cancel')}</Text>
          </Pressable>
          <Text style={styles.headerTitle} accessibilityRole="header">
            {t('events.form.title')}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label} accessibilityRole="header">
            {t('events.form.name')}
          </Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={t('events.form.namePh')}
            placeholderTextColor={c.textFaint}
            maxLength={120}
            accessibilityLabel={t('events.form.name')}
          />

          <Text style={styles.label} accessibilityRole="header">
            {t('events.form.category')}
          </Text>
          <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={t('events.form.category')}>
            {EVENT_CATEGORIES.map((cat) => (
              <Chip key={cat} on={category === cat} onPress={() => pickCategory(cat)} icon={CATEGORY_ICON[cat]} text={t(`events.cat.${cat}`)} />
            ))}
          </View>

          <Text style={styles.label} accessibilityRole="header">
            {t('events.form.alsoList')}
          </Text>
          {category === 'bike' && !extras.includes('family') ? <Text style={styles.hint}>{t('events.form.familyHint')}</Text> : null}
          <View style={styles.wrap}>
            {otherCategories.map((cat) => (
              <Chip
                key={cat}
                multi
                on={extras.includes(cat)}
                onPress={() => toggleExtra(cat)}
                icon={CATEGORY_ICON[cat]}
                text={t(`events.cat.${cat}`)}
              />
            ))}
          </View>

          <Text style={styles.label} accessibilityRole="header">
            {t('events.form.when')}
          </Text>
          <Stepper
            label={t('events.form.date')}
            value={dateText}
            canDec={dayOffset > 0}
            canInc={dayOffset < DAYS_AHEAD - 1}
            onDec={() => setDayOffset((d) => clamp(d - 1, 0, DAYS_AHEAD - 1))}
            onInc={() => setDayOffset((d) => clamp(d + 1, 0, DAYS_AHEAD - 1))}
            onLongDec={() => setDayOffset((d) => clamp(d - 7, 0, DAYS_AHEAD - 1))}
            onLongInc={() => setDayOffset((d) => clamp(d + 7, 0, DAYS_AHEAD - 1))}
            decLabel={t('events.form.prevDay')}
            incLabel={t('events.form.nextDay')}
          />
          <SwitchRow label={t('events.form.allDay')} value={allDay} onChange={setAllDay} />
          {!allDay && (
            <>
              <Stepper
                label={t('events.form.time')}
                value={timeText(minutes)}
                canDec={minutes > 0}
                canInc={minutes < LAST_TIME}
                onDec={() => setMinutes((m) => clamp(m - TIME_STEP, 0, LAST_TIME))}
                onInc={() => setMinutes((m) => clamp(m + TIME_STEP, 0, LAST_TIME))}
                decLabel={t('events.form.earlier')}
                incLabel={t('events.form.later')}
              />
              <Text style={styles.subLabel} accessibilityRole="header">
                {t('events.form.length')}
              </Text>
              <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={t('events.form.length')}>
                {LENGTHS.map((h) => (
                  <Chip key={h} on={length === h} onPress={() => setLength(h)} text={t('events.form.hours', { count: h })} />
                ))}
              </View>
            </>
          )}

          <SwitchRow label={t('events.form.repeat')} value={repeat} onChange={setRepeat} />
          {repeat && (
            <>
              <Stepper
                label={t('events.form.repeat')}
                value={t('events.form.weeks', { count: weeks })}
                canDec={weeks > 2}
                canInc={weeks < MAX_SERIES_WEEKS}
                onDec={() => setWeeks((w) => clamp(w - 1, 2, MAX_SERIES_WEEKS))}
                onInc={() => setWeeks((w) => clamp(w + 1, 2, MAX_SERIES_WEEKS))}
                decLabel={t('events.form.fewerWeeks')}
                incLabel={t('events.form.moreWeeks')}
              />
              {lastDate ? <Text style={styles.hint}>{t('events.form.weeksLast', { date: shortDate(lastDate) })}</Text> : null}
            </>
          )}

          <Text style={styles.label} accessibilityRole="header">
            {t('events.form.venue')}
          </Text>
          {venue ? (
            <View style={styles.venueBox}>
              <Ionicons name="location" size={20} color={c.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.venueTitle}>{venue.title}</Text>
                {venue.subtitle ? <Text style={styles.venueSub}>{venue.subtitle}</Text> : null}
              </View>
              <Pressable
                onPress={() => setVenue(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('events.form.venueChangeA11y', { name: venue.title })}
                style={styles.headerBtn}>
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
                  onPress={() => pickPlace(r)}
                  style={({ pressed }) => [styles.result, pressed && { backgroundColor: c.pressed }]}
                  accessibilityRole="button">
                  <Ionicons name="location-outline" size={18} color={c.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.venueTitle}>{r.title}</Text>
                    {r.subtitle ? <Text style={styles.venueSub}>{r.subtitle}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </>
          )}

          <Text ref={costRef} style={styles.label} accessibilityRole="header">
            {t('events.form.cost')}
          </Text>
          <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={t('events.form.cost')}>
            {COSTS.map((k) => (
              <Chip key={k} on={cost === k} onPress={() => setCost(k)} text={t(COST_KEY[k])} />
            ))}
          </View>
          {cost === 'paid' && (
            <>
              <Text style={styles.subLabel}>{t('events.form.price')}</Text>
              <View style={styles.priceRow}>
                <Text style={styles.dollar} importantForAccessibility="no" accessibilityElementsHidden>
                  $
                </Text>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={priceText}
                  onChangeText={setPriceText}
                  placeholder={t('events.form.pricePh')}
                  placeholderTextColor={c.textFaint}
                  keyboardType="decimal-pad"
                  maxLength={8}
                  accessibilityLabel={t('events.form.price')}
                />
              </View>
            </>
          )}

          <Text style={styles.label} accessibilityRole="header">
            {t('events.form.link')}
          </Text>
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

          <Text style={styles.label} accessibilityRole="header">
            {t('events.form.about')}
          </Text>
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

          <Text style={styles.label} accessibilityRole="header">
            {t('events.form.email')}
          </Text>
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
                <Text key={e} style={styles.errorText}>
                  • {t(e)}
                </Text>
              ))}
            </View>
          )}

          <Pressable
            onPress={send}
            disabled={sending}
            style={({ pressed }) => [styles.submit, (pressed || sending) && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityState={{ busy: sending, disabled: sending }}>
            {sending ? <ActivityIndicator color={c.onAccent} /> : <Ionicons name="send" size={18} color={c.onAccent} />}
            <Text style={styles.submitText}>{sending ? t('events.form.sending') : t('events.form.submit')}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * "‹  value  ›" with 44pt buttons. For VoiceOver it is one adjustable element:
 * swipe up/down to change, and the value is read out.
 */
function Stepper({
  label, value, canDec, canInc, onDec, onInc, onLongDec, onLongInc, decLabel, incLabel,
}: {
  label: string;
  value: string;
  canDec: boolean;
  canInc: boolean;
  onDec: () => void;
  onInc: () => void;
  onLongDec?: () => void;
  onLongInc?: () => void;
  decLabel: string;
  incLabel: string;
}) {
  const { c } = useTheme();
  const styles = useStyles();
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment' && canInc) onInc();
    else if (e.nativeEvent.actionName === 'decrement' && canDec) onDec();
  };
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAction}
      style={styles.stepper}>
      <Pressable
        onPress={onDec}
        onLongPress={onLongDec}
        disabled={!canDec}
        accessibilityRole="button"
        accessibilityLabel={decLabel}
        style={({ pressed }) => [styles.stepBtn, pressed && { backgroundColor: c.pressed }, !canDec && { opacity: 0.35 }]}>
        <Ionicons name="chevron-back" size={22} color={c.primary} />
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable
        onPress={onInc}
        onLongPress={onLongInc}
        disabled={!canInc}
        accessibilityRole="button"
        accessibilityLabel={incLabel}
        style={({ pressed }) => [styles.stepBtn, pressed && { backgroundColor: c.pressed }, !canInc && { opacity: 0.35 }]}>
        <Ionicons name="chevron-forward" size={22} color={c.primary} />
      </Pressable>
    </View>
  );
}

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel} importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

function Chip({ on, onPress, text, icon, multi }: { on: boolean; onPress: () => void; text: string; icon?: string; multi?: boolean }) {
  const { c } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: on } : { selected: on, checked: on }}
      style={[styles.chip, on && styles.chipOn]}>
      {icon ? <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={15} color={on ? c.onPrimary : c.textFaint} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{text}</Text>
      {multi && on ? <Ionicons name="checkmark" size={15} color={c.onPrimary} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  sheet: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8 },
  headerBtn: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  headerTitle: { flexShrink: 1, fontSize: 18, fontFamily: FONT.black, color: c.text, textAlign: 'center' },
  cancel: { fontSize: 16, color: c.primary },
  body: { padding: 16, gap: 8, paddingBottom: 48 },
  label: { fontSize: 15, fontFamily: FONT.bold, color: c.text, marginTop: 12 },
  subLabel: { fontSize: 14, fontFamily: FONT.bold, color: c.textMuted, marginTop: 4 },
  input: {
    minHeight: 48, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: c.text, backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.border,
  },
  multiline: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.surfaceAlt,
  },
  chipOn: { backgroundColor: c.primary },
  chipText: { fontSize: 14, fontFamily: FONT.bold, color: c.textFaint },
  chipTextOn: { color: c.onPrimary },
  stepper: {
    flexDirection: 'row', alignItems: 'center', minHeight: 52, borderRadius: 12, backgroundColor: c.surface, borderWidth: 1,
    borderColor: c.border, paddingHorizontal: 4,
  },
  stepBtn: { width: 44, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepValue: { flex: 1, textAlign: 'center', fontSize: 16, fontFamily: FONT.bold, color: c.text, paddingVertical: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 },
  switchLabel: { flex: 1, fontSize: 16, color: c.text },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dollar: { fontSize: 18, fontFamily: FONT.bold, color: c.textMuted },
  venueBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.border,
  },
  venueTitle: { fontSize: 15, fontFamily: FONT.bold, color: c.text },
  venueSub: { fontSize: 13, color: c.textMuted, marginTop: 1 },
  change: { fontSize: 15, fontFamily: FONT.bold, color: c.primary, textAlign: 'right' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10 },
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
