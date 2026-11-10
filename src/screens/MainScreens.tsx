import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  AppShell,
  BottomNav,
  EmptyCircleArt,
  Field,
  FloatingMascot,
  Icon,
  PrimaryButton,
  ScreenHeader,
  SelectChip,
} from '../components/ui';
import {PRIVACY_SECTIONS, TERMS_SECTIONS} from '../content/legal';
import type {
  AppPreferences,
  DraftContact,
  EmergencyContact,
  FamilyPlan,
  ReminderRule,
  ReminderScheduleValues,
  SelfCheckInSchedule,
  Weekday,
} from '../models';
import {colors, radii} from '../theme';

type Tab = 'home' | 'circle' | 'settings';

function nextReminderText(schedule: SelfCheckInSchedule | null) {
  if (!schedule) return 'Not scheduled';
  if (!schedule.active) return 'Reminder is off';
  const value = new Date(schedule.nextRunAt);
  if (Number.isNaN(value.getTime())) return schedule.times?.[0] || schedule.time || 'Not scheduled';
  return value.toLocaleString('en-IN', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function nextReminderTime(schedule: SelfCheckInSchedule | null) {
  if (!schedule) return 'Choose a time';
  if (!schedule.active) return 'Off';
  const value = new Date(schedule.nextRunAt);
  if (Number.isNaN(value.getTime())) return schedule.times?.[0] || schedule.time || 'Choose a time';
  return value.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const WEEKDAYS: {value: Weekday; label: string; full: string}[] = [
  {value: 1, label: 'Mon', full: 'Monday'},
  {value: 2, label: 'Tue', full: 'Tuesday'},
  {value: 3, label: 'Wed', full: 'Wednesday'},
  {value: 4, label: 'Thu', full: 'Thursday'},
  {value: 5, label: 'Fri', full: 'Friday'},
  {value: 6, label: 'Sat', full: 'Saturday'},
  {value: 0, label: 'Sun', full: 'Sunday'},
];

function timeTo24Hour(value?: string) {
  const clock = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (clock) return value!;
  const legacy = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value || '');
  if (!legacy) return '18:00';
  let hour = Number(legacy[1]) % 12;
  if (legacy[3].toUpperCase() === 'PM') hour += 12;
  return `${String(hour).padStart(2, '0')}:${legacy[2]}`;
}

export function HomeScreen({
  name,
  schedule,
  reminderEnabled,
  acknowledging,
  escalating,
  onManageReminders,
  onAddReminder,
  onEditReminder,
  onAcknowledge,
  onNotOkay,
  onTab,
}: {
  name: string;
  schedule: SelfCheckInSchedule | null;
  reminderEnabled: boolean;
  acknowledging: boolean;
  escalating: boolean;
  onManageReminders: () => void;
  onAddReminder: () => void;
  onEditReminder: (reminderId: string) => void;
  onAcknowledge: () => void;
  onNotOkay: () => void;
  onTab: (tab: Tab) => void;
}) {
  const reminders = useMemo(() => scheduleRules(schedule), [schedule]);
  const reminderIsOn = Boolean(schedule && reminderEnabled && schedule.active);
  const displaySchedule = schedule ? {...schedule, active: reminderIsOn} : null;
  const waiting = reminderIsOn && (schedule?.status === 'waiting-first' || schedule?.status === 'waiting-second');
  const statusCopy = !schedule
    ? 'Set your first reminder'
    : !reminderIsOn
      ? 'Your reminder is off'
    : schedule.status === 'safe'
      ? 'You checked in safely'
      : schedule.status === 'missed'
        ? 'Your circle was alerted'
        : waiting
          ? 'Waiting for your response'
          : 'Reminder is on';

  return (
    <AppShell scroll={false} contentStyle={styles.fullScreen}>
      <ScrollView contentContainerStyle={styles.homeScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.homeHeader}>
          <View>
            <Text style={styles.eyebrow}>HELLO, {name.split(' ')[0].toUpperCase()}</Text>
            <Text style={styles.homeTitle}>My Check-in</Text>
          </View>
          <View style={styles.selfAvatar}><Icon name="person" size={27} color={colors.tealDark} /></View>
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroLabel}>{schedule ? reminderIsOn ? 'NEXT REMINDER' : 'REMINDER OFF' : 'SET YOUR REMINDER'}</Text>
            <Text style={styles.heroTime}>{nextReminderTime(displaySchedule)}</Text>
            <Text style={styles.heroDate}>{schedule ? nextReminderText(displaySchedule) : 'Choose any time that works for you'}</Text>
          </View>
          <View style={styles.heroMascot}><FloatingMascot size={96} /></View>
        </View>

        <View style={styles.statusCard}>
          <View style={[styles.statusIcon, waiting && styles.statusIconWaiting]}>
            <Icon name={waiting ? 'bell' : 'check'} size={24} color={waiting ? '#9A5415' : colors.tealDark} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.statusTitle}>{statusCopy}</Text>
            <Text style={styles.statusText}>
              {schedule
                ? reminderIsOn
                  ? 'A second alert follows after 10 minutes if needed.'
                  : 'Turn Reminder on in Settings when you are ready.'
                : 'Choose when Din Din should check on you.'}
            </Text>
          </View>
          <Pressable testID="manage-reminders" onPress={schedule ? onManageReminders : onAddReminder} accessibilityRole="button" style={styles.editButton}>
            <Text style={styles.editText}>{schedule ? 'Edit' : 'Set'}</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeadingRow}>
          <View>
            <Text style={styles.sectionTitle}>Your reminders</Text>
            <Text style={styles.sectionSub}>{reminders.length ? `${reminders.length} scheduled` : 'No reminder scheduled'}</Text>
          </View>
          <Pressable testID="home-add-reminder" onPress={onAddReminder} style={styles.smallAddButton} accessibilityLabel="Add reminder">
            <Icon name="plus" size={20} color={colors.tealDark} />
          </Pressable>
        </View>

        {reminders.length ? (
          <View style={styles.homeReminderCards}>
            {reminders.map(reminder => (
              <Pressable
                key={reminder.id}
                testID={`home-reminder-${reminder.id}`}
                onPress={() => onEditReminder(reminder.id)}
                style={styles.reminderCard}>
                <View style={styles.reminderCardIcon}><Icon name="bell" size={21} color={colors.tealDark} /></View>
                <View style={styles.flex}>
                  <Text style={styles.reminderCardTime}>{reminder.time}</Text>
                  <Text style={styles.reminderCardDays}>{weekdaySummary(reminder.weekdays)}</Text>
                </View>
                <Icon name="chevron" size={17} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        ) : (
          <Pressable testID="home-empty-reminder" onPress={onAddReminder} style={styles.homeReminderEmpty}>
            <View style={styles.addCircle}><Icon name="clock" size={24} color={colors.tealDark} /></View>
            <View style={styles.flex}>
              <Text style={styles.contactName}>Add your first reminder</Text>
              <Text style={styles.contactMeta}>Choose a time and the days it should repeat.</Text>
            </View>
            <Icon name="chevron" size={18} color={colors.muted} />
          </Pressable>
        )}

      </ScrollView>
      <View style={styles.navDock}><BottomNav active="home" onSelect={onTab} /></View>
      <CheckInPrompt
        visible={waiting}
        second={schedule?.status === 'waiting-second'}
        busy={acknowledging}
        busyNo={escalating}
        onOkay={onAcknowledge}
        onNotOkay={onNotOkay}
      />
    </AppShell>
  );
}

function CheckInPrompt({
  visible,
  second,
  busy,
  busyNo,
  onOkay,
  onNotOkay,
}: {
  visible: boolean;
  second: boolean;
  busy: boolean;
  busyNo: boolean;
  onOkay: () => void;
  onNotOkay: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.modalBackdrop}>
        <View style={styles.checkInModal}>
          <View style={[styles.alarmRing, second && styles.alarmRingUrgent]}>
            <Icon name="bell" size={34} color={second ? colors.coral : colors.tealDark} />
          </View>
          <Text style={styles.modalEyebrow}>{second ? 'SECOND REMINDER' : 'DIN DIN CHECK-IN'}</Text>
          <Text style={styles.modalTitle}>Are you okay?</Text>
          <Text style={styles.modalText}>
            {second
              ? 'Final reminder. Confirm you are safe or alert your circle now.'
              : 'Confirm within one minute. Din Din will retry in 10 minutes if needed.'}
          </Text>
          <View style={styles.modalAction}>
            <PrimaryButton label={busy ? 'Confirming…' : "Yes, I'm okay"} onPress={onOkay} disabled={busy || busyNo} icon="check" />
            <PrimaryButton
              label={busyNo ? 'Alerting circle…' : 'No, I need help'}
              onPress={onNotOkay}
              disabled={busyNo || busy}
              variant="danger"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function AddContactScreen({
  onBack,
  onSave,
  saving,
}: {
  onBack: () => void;
  onSave: (contact: DraftContact) => void;
  saving: boolean;
}) {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('Family');
  const [phone, setPhone] = useState('');
  const [primary, setPrimary] = useState(true);
  const [attempted, setAttempted] = useState(false);
  const cleanPhone = phone.replace(/\D/g, '').slice(0, 10);
  const valid = name.trim().length >= 2 && cleanPhone.length === 10;
  return (
    <AppShell keyboard>
      <ScreenHeader title="Add to My Circle" subtitle="Who should be alerted if you miss both reminders?" onBack={onBack} />
      <View style={styles.formGap}>
        <Field
          label="Contact name"
          placeholder="Enter their name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          error={attempted && name.trim().length < 2 ? 'Please enter a name' : undefined}
        />
        <View style={styles.group}>
          <Text style={styles.inputLabel}>Relationship</Text>
          <View style={styles.chipGrid}>
            {['Family', 'Partner', 'Friend', 'Neighbour', 'Caregiver', 'Other'].map(item => (
              <View key={item} style={styles.chipCell}>
                <SelectChip label={item} selected={relationship === item} onPress={() => setRelationship(item)} />
              </View>
            ))}
          </View>
        </View>
        <Field
          label="WhatsApp number"
          prefix="+91"
          placeholder="10-digit mobile number"
          keyboardType="phone-pad"
          value={cleanPhone}
          onChangeText={setPhone}
          maxLength={10}
          error={attempted && cleanPhone.length !== 10 ? 'Enter a valid WhatsApp number' : undefined}
          hint="We contact this number only after both reminders are missed."
        />
        <View style={styles.primaryToggleCard}>
          <View style={styles.primaryToggleIcon}><Icon name="bell" size={20} color={colors.tealDark} /></View>
          <View style={styles.flex}>
            <Text style={styles.primaryToggleTitle}>Primary contact</Text>
            <Text style={styles.primaryToggleText}>Send missed check-in alerts to this person.</Text>
          </View>
          <Switch value={primary} onValueChange={setPrimary} trackColor={{false: '#CAD6D8', true: '#89D7C9'}} thumbColor={primary ? colors.tealDark : colors.white} />
        </View>
      </View>
      <View style={styles.bottomPush}>
        <PrimaryButton
          label={saving ? 'Adding contact…' : 'Add to My Circle'}
          disabled={saving}
          onPress={() => {
            setAttempted(true);
            if (valid) onSave({name: name.trim(), relationship, phone: `+91${cleanPhone}`, primary});
          }}
        />
      </View>
    </AppShell>
  );
}

export function ScheduleScreen({
  schedule,
  primaryContactCount,
  safetyLocationEnabled,
  saving,
  editorRequest,
  onBack,
  onAddContact,
  onEnableLocation,
  onEditorRequestHandled,
  onRequestEditor,
  onDelete,
  onSave,
}: {
  schedule: SelfCheckInSchedule | null;
  primaryContactCount: number;
  safetyLocationEnabled: boolean;
  saving: boolean;
  editorRequest: {key: number; reminderId?: string} | null;
  onBack: () => void;
  onAddContact: () => void;
  onEnableLocation: () => void;
  onEditorRequestHandled: (key: number) => void;
  onRequestEditor: (reminderId?: string) => void;
  onDelete: (reminderId: string) => Promise<boolean>;
  onSave: (values: ReminderScheduleValues) => Promise<boolean>;
}) {
  const reminders = useMemo(() => scheduleRules(schedule), [schedule]);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [hour, setHour] = useState('18');
  const [minute, setMinute] = useState('00');
  const [weekdays, setWeekdays] = useState<Weekday[]>(WEEKDAYS.map(day => day.value));
  const [error, setError] = useState('');
  const [editorAction, setEditorAction] = useState<'save' | 'delete' | null>(null);
  const handledEditorRequest = useRef(0);

  useEffect(() => {
    if (!editorRequest || handledEditorRequest.current === editorRequest.key) return;
    handledEditorRequest.current = editorRequest.key;
    const editing = reminders.find(item => item.id === editorRequest.reminderId);
    const fallback = suggestedReminderTime(reminders);
    const [nextHour, nextMinute] = (editing?.time || fallback).split(':');
    setEditingId(editing?.id);
    setHour(nextHour);
    setMinute(nextMinute);
    setWeekdays(editing?.weekdays?.length
      ? editing.weekdays
      : WEEKDAYS.map(day => day.value));
    setError('');
    setEditorAction(null);
    setEditorVisible(true);
    onEditorRequestHandled(editorRequest.key);
  }, [editorRequest, onEditorRequestHandled, reminders]);

  const saveEditor = async () => {
    const rule: ReminderRule = {
      id: editingId || `reminder-${Date.now()}`,
      time: `${hour}:${minute}`,
      weekdays: WEEKDAYS.map(day => day.value).filter(day => weekdays.includes(day)),
    };
    if (!rule.weekdays.length) {
      setError('Choose at least one active day.');
      return;
    }
    const next = editingId
      ? reminders.map(item => item.id === editingId ? rule : item)
      : [...reminders, rule];
    const validation = validateReminderRules(next);
    if (validation) {
      setError(validation);
      return;
    }
    setEditorAction('save');
    try {
      if (await onSave({reminders: next})) setEditorVisible(false);
    } finally {
      setEditorAction(null);
    }
  };

  const confirmDelete = () => {
    if (!editingId) return;
    const reminder = reminders.find(item => item.id === editingId);
    Alert.alert(
      'Delete reminder?',
      `${reminder?.time || 'This reminder'} will be removed from your schedule.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setEditorAction('delete');
            try {
              if (await onDelete(editingId)) {
                setEditorVisible(false);
                setEditingId(undefined);
              }
            } finally {
              setEditorAction(null);
            }
          },
        },
      ],
    );
  };

  return (
    <AppShell>
      <ScreenHeader title="My reminders" subtitle="Your check-in times" onBack={onBack} />
      <View style={styles.reminderListHeader}>
        <Text style={styles.sectionLabel}>{reminders.length} ACTIVE REMINDER{reminders.length === 1 ? '' : 'S'}</Text>
        <Text style={styles.twentyFourHourBadge}>24 HOUR</Text>
      </View>
      <View style={styles.reminderCards}>
        {reminders.map(reminder => (
          <Pressable
            key={reminder.id}
            testID={`reminder-card-${reminder.id}`}
            onPress={() => onRequestEditor(reminder.id)}
            style={styles.reminderCard}>
            <View style={styles.reminderCardIcon}><Icon name="bell" size={21} color={colors.tealDark} /></View>
            <View style={styles.flex}>
              <Text style={styles.reminderCardTime}>{reminder.time}</Text>
              <Text style={styles.reminderCardDays}>{weekdaySummary(reminder.weekdays)}</Text>
            </View>
            <Text style={styles.reminderEditText}>Edit</Text>
            <Icon name="chevron" size={17} color={colors.muted} />
          </Pressable>
        ))}
        {!reminders.length ? (
          <View style={styles.reminderEmptyCard}>
            <View style={styles.reminderEmptyIcon}><Icon name="clock" size={28} color={colors.tealDark} /></View>
            <Text style={styles.reminderEmptyTitle}>No reminders yet</Text>
            <Text style={styles.reminderEmptyText}>Add a time and choose exactly which days it should repeat.</Text>
          </View>
        ) : null}
      </View>
      {primaryContactCount === 0 ? (
        <Pressable onPress={onAddContact} style={styles.requirementWarning}>
          <Icon name="person" size={21} color="#9A5415" />
          <View style={styles.flex}>
            <Text style={styles.requirementTitle}>Save at least one primary contact</Text>
            <Text style={styles.requirementText}>Tap here to add the person who should receive your safety alert.</Text>
          </View>
          <Icon name="chevron" size={18} color="#9A5415" />
        </Pressable>
      ) : null}
      {!safetyLocationEnabled ? (
        <Pressable onPress={onEnableLocation} style={styles.requirementWarning}>
          <Icon name="shield" size={21} color="#9A5415" />
          <View style={styles.flex}>
            <Text style={styles.requirementTitle}>Enable safety location</Text>
            <Text style={styles.requirementText}>Required to share your location after a missed check-in.</Text>
          </View>
          <Icon name="chevron" size={18} color="#9A5415" />
        </Pressable>
      ) : null}
      <View style={styles.reminderAddAction}>
        <PrimaryButton
          testID="add-reminder"
          label="Add reminder"
          onPress={() => onRequestEditor()}
          disabled={saving || reminders.length >= 12}
          icon="plus"
        />
      </View>
      <Modal visible={editorVisible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setEditorVisible(false)}>
        <View style={styles.reminderEditorBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && setEditorVisible(false)} />
          <View style={styles.reminderEditorSheet}>
            <View style={styles.reminderSheetHandle} />
            <View style={styles.reminderEditorHeader}>
              <Pressable onPress={() => setEditorVisible(false)} disabled={saving} hitSlop={10}>
                <Text style={styles.reminderEditorCancel}>Cancel</Text>
              </Pressable>
              <Text style={styles.reminderEditorTitle}>{editingId ? 'Edit reminder' : 'New reminder'}</Text>
              <Pressable testID="save-reminder-editor" onPress={saveEditor} disabled={saving} hitSlop={10}>
                <Text style={styles.reminderEditorDone}>{editorAction === 'save' ? 'Saving...' : 'Done'}</Text>
              </Pressable>
            </View>
            <View style={styles.editorTitleBlock}>
              <Text style={styles.sectionLabel}>REMINDER TIME</Text>
              <Text style={styles.reminderEditorHint}>Scroll hours and minutes · 24-hour clock</Text>
            </View>
            <View style={styles.wheelClockCard}>
              <View pointerEvents="none" style={styles.wheelMintGlow} />
              <View pointerEvents="none" style={styles.wheelSkyGlow} />
              <View pointerEvents="none" style={styles.wheelAmberDot} />
              <View pointerEvents="none" style={styles.wheelSelection} />
              <WheelColumn
                testID="reminder-hour-wheel"
                values={HOUR_VALUES}
                selected={hour}
                onChange={setHour}
              />
              <Text style={styles.wheelColon}>:</Text>
              <WheelColumn
                testID="reminder-minute-wheel"
                values={MINUTE_VALUES}
                selected={minute}
                onChange={setMinute}
              />
            </View>
            <View style={styles.editorRepeatCard}>
              <View style={styles.scheduleLabelRow}>
                <View>
                  <Text style={styles.editorRepeatTitle}>Repeat</Text>
                  <Text style={styles.editorRepeatSummary}>{weekdaySummary(weekdays)}</Text>
                </View>
                <Text style={styles.twentyFourHourBadge}>CUSTOM</Text>
              </View>
              <View style={styles.editorWeekdayRow}>
                {WEEKDAYS.map(day => {
                  const selected = weekdays.includes(day.value);
                  return (
                    <Pressable
                      key={day.value}
                      testID={`editor-weekday-${day.value}`}
                      accessibilityRole="checkbox"
                      accessibilityLabel={day.full}
                      accessibilityState={{checked: selected}}
                      onPress={() => setWeekdays(current => current.includes(day.value)
                        ? current.filter(value => value !== day.value)
                        : [...current, day.value])}
                      style={[styles.editorWeekday, selected && styles.editorWeekdaySelected]}>
                      <Text style={[styles.editorWeekdayText, selected && styles.editorWeekdayTextSelected]}>{day.label.slice(0, 1)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={styles.editorFooterNote}>
              <Icon name="bell" size={18} color={colors.tealDark} />
              <Text style={styles.editorFooterText}>A second alert follows after 10 minutes if you do not respond.</Text>
            </View>
            {editingId ? (
              <Pressable
                testID="delete-reminder-editor"
                accessibilityRole="button"
                accessibilityLabel="Delete reminder"
                onPress={confirmDelete}
                disabled={saving}
                style={styles.deleteReminderButton}>
                <Text style={styles.deleteReminderText}>{editorAction === 'delete' ? 'Deleting...' : 'Delete reminder'}</Text>
              </Pressable>
            ) : null}
            {error ? <Text style={styles.editorError}>{error}</Text> : null}
          </View>
        </View>
      </Modal>
    </AppShell>
  );
}

const WHEEL_ITEM_HEIGHT = 58;
const HOUR_VALUES = Array.from({length: 24}, (_, index) => String(index).padStart(2, '0'));
const MINUTE_VALUES = Array.from({length: 60}, (_, index) => String(index).padStart(2, '0'));

function WheelColumn({
  values,
  selected,
  onChange,
  testID,
}: {
  values: string[];
  selected: string;
  onChange: (value: string) => void;
  testID: string;
}) {
  const ref = useRef<React.ElementRef<typeof ScrollView>>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestOffset = useRef(0);
  const selectFromOffset = (offset: number) => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(offset / WHEEL_ITEM_HEIGHT)));
    onChange(values[index]);
  };
  const clearSettleTimer = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
  };
  useEffect(() => {
    const index = Math.max(0, values.indexOf(selected));
    latestOffset.current = index * WHEEL_ITEM_HEIGHT;
    requestAnimationFrame(() => ref.current?.scrollTo({y: index * WHEEL_ITEM_HEIGHT, animated: false}));
  }, [selected, values]);
  useEffect(() => clearSettleTimer, []);
  return (
    <ScrollView
      ref={ref}
      testID={testID}
      style={styles.wheelColumn}
      contentContainerStyle={styles.wheelContent}
      showsVerticalScrollIndicator={false}
      snapToInterval={WHEEL_ITEM_HEIGHT}
      snapToAlignment="start"
      decelerationRate={0.985}
      scrollEventThrottle={16}
      nestedScrollEnabled
      onScroll={event => {
        latestOffset.current = event.nativeEvent.contentOffset.y;
      }}
      onMomentumScrollBegin={clearSettleTimer}
      onMomentumScrollEnd={event => {
        clearSettleTimer();
        latestOffset.current = event.nativeEvent.contentOffset.y;
        selectFromOffset(latestOffset.current);
      }}
      onScrollEndDrag={() => {
        clearSettleTimer();
        settleTimer.current = setTimeout(() => selectFromOffset(latestOffset.current), 140);
      }}>
      <View style={styles.wheelSpacer} />
      {values.map(value => (
        <View key={value} style={styles.wheelItem}>
          <Text style={[styles.wheelValue, value === selected && styles.wheelValueSelected]}>{value}</Text>
        </View>
      ))}
      <View style={styles.wheelSpacer} />
    </ScrollView>
  );
}

function scheduleRules(schedule: SelfCheckInSchedule | null): ReminderRule[] {
  if (schedule?.reminders?.length) return schedule.reminders;
  const legacyTimes = schedule?.times?.length
    ? schedule.times
    : schedule?.time ? [schedule.time] : [];
  const days = schedule?.weekdays?.length
    ? schedule.weekdays
    : WEEKDAYS.map(day => day.value);
  return legacyTimes.map((time, index) => ({
    id: `legacy-${index + 1}`,
    time: timeTo24Hour(time),
    weekdays: days,
  }));
}

function suggestedReminderTime(reminders: ReminderRule[]) {
  const now = new Date();
  const used = new Set(reminders.map(item => item.time));
  const rounded = (now.getHours() * 60 + Math.ceil(now.getMinutes() / 5) * 5) % (24 * 60);
  for (let offset = 0; offset < 24 * 60; offset += 5) {
    const value = (rounded + offset) % (24 * 60);
    const candidate = `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
  return '18:00';
}

function weekdaySummary(weekdays: Weekday[]) {
  if (weekdays.length === 7) return 'Every day';
  if (weekdays.length === 5 && [1, 2, 3, 4, 5].every(day => weekdays.includes(day as Weekday))) return 'Weekdays';
  return WEEKDAYS.filter(day => weekdays.includes(day.value)).map(day => day.label).join(', ') || 'Choose days';
}

function validateReminderRules(reminders: ReminderRule[]) {
  if (!reminders.length || reminders.length > 12) return 'You can keep between 1 and 12 reminders.';
  const occurrences = reminders.flatMap(reminder => reminder.weekdays.map(day => {
    const [hour, minute] = reminder.time.split(':').map(Number);
    return day * 24 * 60 + hour * 60 + minute;
  })).sort((left, right) => left - right);
  if (new Set(occurrences).size !== occurrences.length) return 'A reminder already exists at this time on one of these days.';
  const spaced = occurrences.every((value, index) => {
    const next = occurrences[(index + 1) % occurrences.length] +
      (index === occurrences.length - 1 ? 7 * 24 * 60 : 0);
    return next - value >= 15;
  });
  return spaced ? '' : 'Keep at least 15 minutes between reminders on the same day.';
}

export function CircleScreen({
  contacts,
  onAdd,
  onTogglePrimary,
  onRemove,
  onTab,
}: {
  contacts: EmergencyContact[];
  onAdd: () => void;
  onTogglePrimary: (contact: EmergencyContact, value: boolean) => void;
  onRemove: (contact: EmergencyContact) => void;
  onTab: (tab: Tab) => void;
}) {
  const primaryCount = useMemo(() => contacts.filter(contact => contact.primary).length, [contacts]);
  return (
    <AppShell scroll={false} contentStyle={styles.fullScreen}>
      <View style={styles.homeHeader}>
        <View>
          <Text style={styles.homeTitle}>My Circle</Text>
          <Text style={styles.homeSubtitle}>People who can be alerted on WhatsApp.</Text>
        </View>
        <Pressable onPress={onAdd} style={styles.smallAddButton} accessibilityLabel="Add contact">
          <Icon name="plus" size={23} color={colors.tealDark} />
        </Pressable>
      </View>
      <View style={styles.circleSummary}>
        <View style={styles.circleSummaryIcon}><Icon name="shield" size={24} color={colors.tealDark} /></View>
        <View style={styles.flex}>
          <Text style={styles.circleSummaryTitle}>{primaryCount} primary contact{primaryCount === 1 ? '' : 's'}</Text>
          <Text style={styles.circleSummaryText}>Primary contacts receive the missed check-in alert.</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.circleList} showsVerticalScrollIndicator={false}>
        {contacts.length ? contacts.map((contact, index) => (
          <View key={contact.id} style={styles.contactCard}>
            <View style={[styles.contactAvatar, index % 2 ? styles.avatarWarm : styles.avatarMint]}>
              <Text style={styles.contactAvatarText}>{contact.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.contactName}>{contact.name}</Text>
              <Text style={styles.contactMeta}>{contact.relationship} · {contact.phone}</Text>
              <Pressable onPress={() => onRemove(contact)} hitSlop={8}>
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
            <View style={styles.primarySwitch}>
              <Text style={styles.primarySwitchLabel}>PRIMARY</Text>
              <Switch
                value={contact.primary}
                onValueChange={value => onTogglePrimary(contact, value)}
                trackColor={{false: '#CAD6D8', true: '#89D7C9'}}
                thumbColor={contact.primary ? colors.tealDark : colors.white}
              />
            </View>
          </View>
        )) : (
          <View style={styles.circleEmpty}>
            <EmptyCircleArt />
            <Text style={styles.emptyTitle}>Build your safety circle</Text>
            <Text style={styles.emptyText}>Add people you trust to receive safety alerts.</Text>
            <View style={styles.emptyButton}><PrimaryButton label="Add a contact" icon="plus" onPress={onAdd} /></View>
          </View>
        )}
      </ScrollView>
      <View style={styles.navDock}><BottomNav active="circle" onSelect={onTab} /></View>
    </AppShell>
  );
}

export function SettingsScreen({
  preferences,
  onPreferencesChange,
  onSafetyLocation,
  onPrivacy,
  onManageBilling,
  onFamily,
  onLogout,
  onDeleteAccount,
  deletingAccount,
  onTab,
}: {
  preferences: AppPreferences;
  onPreferencesChange: (preferences: AppPreferences) => void;
  onSafetyLocation: () => void;
  onPrivacy: () => void;
  onManageBilling: () => void;
  onFamily: () => void;
  onLogout: () => void;
  onDeleteAccount: () => void;
  deletingAccount: boolean;
  onTab: (tab: Tab) => void;
}) {
  const update = (next: Partial<AppPreferences>) => onPreferencesChange({...preferences, ...next});
  return (
    <AppShell scroll={false} contentStyle={styles.fullScreen}>
      <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.settingsScrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.simpleHeader}>
          <Text style={styles.homeTitle}>Settings</Text>
        </View>
        <View style={styles.settingsList}>
          <SettingToggle testID="setting-alerts" icon="bell" title="Reminder" subtitle="Turn scheduled reminders on or off" value={preferences.notifications} onChange={value => update({notifications: value})} />
          <SettingToggle testID="setting-sounds" icon="message" title="Sound" subtitle="Play an alarm sound for one minute" value={preferences.sounds} onChange={value => update({sounds: value})} />
          <SettingToggle testID="setting-vibration" icon="bell" title="Vibration" subtitle="Vibrate during the alert window" value={preferences.vibration} onChange={value => update({vibration: value})} />
          {!preferences.safetyLocation ? (
            <SettingRow testID="setting-location" icon="shield" title="Safety location" subtitle="Tap to enable Always access" onPress={onSafetyLocation} />
          ) : null}
          <SettingRow testID="setting-privacy" icon="shield" title="Privacy & Terms & Conditions" subtitle="Privacy Policy and Terms & Conditions" onPress={onPrivacy} />
          <SettingRow testID="setting-manage-billing" icon="settings" title="Manage subscription" subtitle="View or cancel through Google Play" onPress={onManageBilling} />
          <SettingRow testID="setting-family" icon="settings" title="Family members" subtitle="Manage the numbers covered by a family plan" onPress={onFamily} />
        </View>
        <Pressable
          accessibilityRole="button"
          testID="setting-logout"
          onPress={onLogout}
          style={({pressed}) => [styles.logoutButton, pressed && styles.logoutButtonPressed]}>
          <Icon name="logout" size={20} color={colors.coral} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{disabled: deletingAccount}}
          testID="setting-delete-account"
          disabled={deletingAccount}
          onPress={onDeleteAccount}
          style={({pressed}) => [
            styles.deleteAccountButton,
            pressed && !deletingAccount && styles.deleteAccountButtonPressed,
          ]}>
          <Text style={styles.deleteAccountTitle}>
            {deletingAccount ? 'Deleting account…' : 'Delete account'}
          </Text>
          <Text style={styles.deleteAccountText}>Permanently remove your Din Din account and data</Text>
        </Pressable>
      </ScrollView>
      <View style={styles.navDock}><BottomNav active="settings" onSelect={onTab} /></View>
    </AppShell>
  );
}

export function FamilyMembersScreen({
  family,
  ownerPhone,
  loading,
  adding,
  onBack,
  onAdd,
  onChoosePlan,
}: {
  family: FamilyPlan | null;
  ownerPhone?: string;
  loading: boolean;
  adding: boolean;
  onBack: () => void;
  onAdd: (phone: string) => Promise<void>;
  onChoosePlan: (minimumCapacity?: number) => void;
}) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const members = family?.members ?? [];
  const capacity = family?.capacity ?? 3;
  const assignedAccounts = family?.role === 'owner' ? members.length + 1 : members.length;
  const memberSlots = Math.max(0, capacity - 1);
  const nextCapacity = Math.min(8, Math.max(3, assignedAccounts + 1));
  const add = () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) {
      setError('Enter a valid mobile number with country code.');
      return;
    }
    setError('');
    Alert.alert(
      'Permanently assign this member?',
      `${phone.trim()} cannot be changed or replaced after it is added to this family plan.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Add permanently',
          onPress: () => onAdd(phone.trim())
            .then(() => setPhone(''))
            .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not add this member.')),
        },
      ],
    );
  };

  return (
    <AppShell>
      <ScreenHeader
        title="Family members"
        subtitle={family?.role === 'owner'
          ? `${capacity} covered accounts including you`
          : 'Manage family access'}
        onBack={onBack}
      />
      {loading ? <Text style={styles.familyLoading}>Loading your family plan…</Text> : null}
      {!loading && family?.role === 'member' ? (
        <View style={styles.familyHero}>
          <View style={styles.familyHeroIcon}><Icon name="shield" size={26} color={colors.tealDark} /></View>
          <Text style={styles.familyHeroTitle}>You are covered</Text>
          <Text style={styles.familyHeroText}>Your premium access is provided by a Din Din family plan.</Text>
        </View>
      ) : null}
      {!loading && family?.role === 'owner' ? (
        <>
          <View style={styles.familySummaryCard}>
            <View>
              <Text style={styles.familySummaryTitle}>{family.active ? 'Family plan active' : 'Family plan inactive'}</Text>
              <Text style={styles.familySummaryText}>{assignedAccounts} of {capacity} accounts covered</Text>
            </View>
            <View style={styles.familyCountPill}><Text style={styles.familyCountText}>{assignedAccounts}/{capacity}</Text></View>
          </View>
          <View style={styles.familyMemberCard}>
            <View style={styles.familyMemberNumber}><Text style={styles.familyMemberNumberText}>1</Text></View>
            <View style={styles.flex}>
              <Text style={styles.familyMemberPhone}>{ownerPhone || 'Your Din Din account'}</Text>
              <Text style={styles.familyMemberLocked}>Plan purchaser</Text>
            </View>
            <Icon name="shield" size={18} color={colors.teal} />
          </View>
          {members.map((member, index) => (
            <View key={member.id} style={styles.familyMemberCard}>
              <View style={styles.familyMemberNumber}><Text style={styles.familyMemberNumberText}>{index + 2}</Text></View>
              <View style={styles.flex}>
                <Text style={styles.familyMemberPhone}>{member.phone}</Text>
                <Text style={styles.familyMemberLocked}>Permanently assigned</Text>
              </View>
              <Icon name="shield" size={18} color={colors.teal} />
            </View>
          ))}
          {family.active && members.length < memberSlots ? (
            <View style={styles.familyAddCard}>
              <Field
                label="Member mobile number"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
                placeholder="+91 98765 43210"
                error={error}
                hint="Include the country code."
              />
              <PrimaryButton label={adding ? 'Adding member…' : 'Add member'} disabled={adding} onPress={add} />
            </View>
          ) : null}
          {family.active && members.length >= memberSlots && capacity < 8 ? (
            <View style={styles.familyHeroButton}>
              <PrimaryButton
                label="Upgrade to add another member"
                onPress={() => onChoosePlan(nextCapacity)}
              />
            </View>
          ) : null}
          {family.active && members.length >= memberSlots && capacity >= 8 ? (
            <Text style={styles.familyLockText}>All 8 covered-account slots are assigned.</Text>
          ) : null}
          {!family.active ? (
            <PrimaryButton
              label="Choose a family plan"
              onPress={() => onChoosePlan(Math.max(3, assignedAccounts))}
            />
          ) : null}
        </>
      ) : null}
      {!loading && (!family || family.role === null) ? (
        <View style={styles.familyHero}>
          <View style={styles.familyHeroIcon}><Icon name="person" size={26} color={colors.tealDark} /></View>
          <Text style={styles.familyHeroTitle}>Cover your family</Text>
          <Text style={styles.familyHeroText}>Choose 3 to 8 covered accounts. Your own account is included in the total.</Text>
          <View style={styles.familyHeroButton}>
            <PrimaryButton label="View family plans" onPress={() => onChoosePlan(3)} />
          </View>
        </View>
      ) : null}
      <View style={styles.familyLockNotice}>
        <Icon name="shield" size={18} color={colors.coral} />
        <Text style={styles.familyLockText}>For abuse prevention, a number cannot be edited, removed, or replaced after it is assigned.</Text>
      </View>
    </AppShell>
  );
}

export function PrivacySettingsScreen({onBack}: {onBack: () => void}) {
  const [document, setDocument] = useState<'privacy' | 'terms'>('privacy');
  const privacy = document === 'privacy';
  const sections = privacy ? PRIVACY_SECTIONS : TERMS_SECTIONS;
  return (
    <AppShell>
      <ScreenHeader title="Privacy & Terms" subtitle="Effective 24 October 2026" onBack={onBack} />
      <View style={styles.legalTabs}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{selected: privacy}}
          onPress={() => setDocument('privacy')}
          style={[styles.legalTab, privacy && styles.legalTabSelected]}>
          <Text style={[styles.legalTabText, privacy && styles.legalTabTextSelected]}>Privacy Policy</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{selected: !privacy}}
          onPress={() => setDocument('terms')}
          style={[styles.legalTab, !privacy && styles.legalTabSelected]}>
          <Text style={[styles.legalTabText, !privacy && styles.legalTabTextSelected]}>Terms & Conditions</Text>
        </Pressable>
      </View>

      <View style={styles.legalIntro}>
        <View style={styles.legalIntroIcon}><Icon name="shield" size={25} color={colors.tealDark} /></View>
        <View style={styles.flex}>
          <Text style={styles.legalIntroTitle}>{privacy ? 'Your information, handled with care' : 'Clear expectations for every check-in'}</Text>
          <Text style={styles.legalIntroText}>
            {privacy
              ? 'What Din Din collects, why it is used, and the choices available to you.'
              : 'The conditions that apply when you use Din Din and its safety alerts.'}
          </Text>
        </View>
      </View>

      <View style={styles.legalNotice}>
        <Text style={styles.legalNoticeTitle}>Important safety notice</Text>
        <Text style={styles.legalNoticeText}>
          Din Din is not an emergency, medical, security, or continuous monitoring service. If someone may be in danger, contact them directly and use appropriate local emergency services.
        </Text>
      </View>

      {sections.map(section => (
        <View key={section.title} style={styles.legalSection}>
          <Text style={styles.legalSectionTitle}>{section.title}</Text>
          {section.paragraphs?.map((paragraph, index) => (
            <Text key={`${section.title}-paragraph-${index}`} style={styles.legalBody}>{paragraph}</Text>
          ))}
          {section.bullets?.map((bullet, index) => (
            <View key={`${section.title}-bullet-${index}`} style={styles.legalBulletRow}>
              <View style={styles.legalBullet} />
              <Text style={styles.legalBulletText}>{bullet}</Text>
            </View>
          ))}
        </View>
      ))}
    </AppShell>
  );
}

function SettingRow({icon, title, subtitle, onPress, testID}: {icon: 'shield' | 'settings'; title: string; subtitle: string; onPress: () => void; testID?: string}) {
  return (
    <Pressable accessibilityRole="button" testID={testID} onPress={onPress} style={({pressed}) => [styles.settingRow, pressed && styles.settingRowPressed]}>
      <View style={styles.settingIcon}><Icon name={icon} size={20} color={colors.tealDark} /></View>
      <View style={styles.settingCopy}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.settingSubtitle}>{subtitle}</Text></View>
      <Icon name="chevron" size={17} color={colors.muted} />
    </Pressable>
  );
}

function SettingToggle({icon, title, subtitle, value, onChange, testID}: {icon: 'bell' | 'message'; title: string; subtitle: string; value: boolean; onChange: (value: boolean) => void; testID?: string}) {
  return (
    <View style={styles.settingRow} testID={testID}>
      <View style={styles.settingIcon}><Icon name={icon} size={20} color={colors.tealDark} /></View>
      <View style={styles.settingCopy}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.settingSubtitle}>{subtitle}</Text></View>
      <Switch value={value} onValueChange={onChange} trackColor={{false: '#CAD6D8', true: '#89D7C9'}} thumbColor={value ? colors.tealDark : colors.white} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  fullScreen: {paddingHorizontal: 0, flex: 1},
  homeScroll: {paddingBottom: 22},
  homeHeader: {paddingHorizontal: 22, paddingTop: 8, paddingBottom: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  eyebrow: {fontSize: 10, color: colors.teal, fontWeight: '900', letterSpacing: 1.2},
  homeTitle: {fontSize: 32, lineHeight: 38, color: colors.ink, fontWeight: '900', letterSpacing: -1},
  homeSubtitle: {fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 2},
  selfAvatar: {width: 48, height: 48, borderRadius: 18, backgroundColor: colors.mint, borderWidth: 1, borderColor: '#B9E7DB', alignItems: 'center', justifyContent: 'center'},
  heroCard: {marginHorizontal: 22, height: 142, borderRadius: radii.xl, overflow: 'hidden', backgroundColor: colors.tealDark, flexDirection: 'row', padding: 20, shadowColor: colors.shadow, shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: {width: 0, height: 8}, elevation: 5},
  heroCopy: {flex: 1, justifyContent: 'center'},
  heroLabel: {fontSize: 9, letterSpacing: 1.2, fontWeight: '900', color: '#83DBCC'},
  heroTime: {fontSize: 27, lineHeight: 33, fontWeight: '900', color: colors.white, marginTop: 7},
  heroDate: {fontSize: 11, lineHeight: 16, color: '#C3E4E0', marginTop: 4},
  heroMascot: {width: 116, marginRight: -22, marginBottom: -27, alignItems: 'center', justifyContent: 'center'},
  statusCard: {marginHorizontal: 22, marginTop: 14, minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radii.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 14},
  statusIcon: {width: 48, height: 48, borderRadius: 17, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center'},
  statusIconWaiting: {backgroundColor: colors.amberSoft},
  statusTitle: {fontSize: 14, fontWeight: '900', color: colors.ink},
  statusText: {fontSize: 10, lineHeight: 15, color: colors.muted, marginTop: 3},
  editButton: {paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.mintSoft},
  editText: {fontSize: 11, fontWeight: '900', color: colors.tealDark},
  sectionHeadingRow: {marginHorizontal: 22, marginTop: 20, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  sectionTitle: {fontSize: 17, fontWeight: '900', color: colors.ink},
  sectionSub: {fontSize: 10, color: colors.muted, marginTop: 3},
  smallAddButton: {width: 43, height: 43, borderRadius: 16, backgroundColor: colors.mint, borderWidth: 1, borderColor: '#B9E7DB', alignItems: 'center', justifyContent: 'center'},
  homeReminderCards: {marginHorizontal: 22, gap: 9},
  homeReminderEmpty: {marginHorizontal: 22, minHeight: 76, borderRadius: radii.lg, backgroundColor: colors.mintSoft, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#91D5C8', flexDirection: 'row', alignItems: 'center', padding: 12, gap: 11},
  contactStrip: {marginHorizontal: 22, gap: 8},
  contactMini: {minHeight: 66, borderRadius: radii.md, backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10},
  contactAvatar: {width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
  avatarWarm: {backgroundColor: '#FFE7C3'},
  avatarMint: {backgroundColor: colors.mint},
  contactAvatarText: {fontSize: 20, fontWeight: '900', color: colors.tealDark},
  contactName: {fontSize: 14, fontWeight: '900', color: colors.ink},
  contactMeta: {fontSize: 10, lineHeight: 14, color: colors.muted, marginTop: 3},
  primaryPill: {borderRadius: 999, backgroundColor: colors.mintSoft, paddingHorizontal: 8, paddingVertical: 5},
  primaryPillText: {fontSize: 8, fontWeight: '900', letterSpacing: 0.7, color: colors.tealDark},
  emptyContactCard: {marginHorizontal: 22, minHeight: 76, borderRadius: radii.lg, backgroundColor: colors.mintSoft, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#91D5C8', flexDirection: 'row', alignItems: 'center', padding: 12, gap: 11},
  addCircle: {width: 46, height: 46, borderRadius: 16, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center'},
  escalationCard: {marginHorizontal: 22, marginTop: 18, padding: 16, borderRadius: radii.lg, backgroundColor: colors.sky, borderWidth: 1, borderColor: '#CBE6EB'},
  escalationTitle: {fontSize: 14, fontWeight: '900', color: colors.ink, marginBottom: 13},
  escalationRow: {minHeight: 56, flexDirection: 'row'},
  escalationRail: {width: 34, alignItems: 'center'},
  escalationNumber: {width: 27, height: 27, borderRadius: 10, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center'},
  escalationNumberText: {fontSize: 10, fontWeight: '900', color: colors.tealDark},
  escalationLine: {width: 2, flex: 1, backgroundColor: '#B8D8DE'},
  escalationCopy: {flex: 1, paddingLeft: 9, paddingBottom: 10},
  escalationStepTitle: {fontSize: 12, fontWeight: '900', color: colors.ink},
  escalationStepText: {fontSize: 10, lineHeight: 14, color: colors.muted, marginTop: 2},
  navDock: {marginTop: 'auto', paddingBottom: 2, backgroundColor: 'rgba(249,247,241,0.9)'},
  modalBackdrop: {flex: 1, backgroundColor: 'rgba(5,34,47,0.64)', alignItems: 'center', justifyContent: 'center', padding: 24},
  checkInModal: {width: '100%', maxWidth: 420, borderRadius: 32, backgroundColor: colors.cream, alignItems: 'center', padding: 25},
  alarmRing: {width: 78, height: 78, borderRadius: 27, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', borderWidth: 8, borderColor: '#DDF7EF'},
  alarmRingUrgent: {backgroundColor: colors.coralSoft, borderColor: '#FFE5E2'},
  modalEyebrow: {fontSize: 10, letterSpacing: 1.2, fontWeight: '900', color: colors.teal, marginTop: 18},
  modalTitle: {fontSize: 29, lineHeight: 35, fontWeight: '900', color: colors.ink, marginTop: 7},
  modalText: {fontSize: 13, lineHeight: 20, color: colors.muted, textAlign: 'center', marginTop: 8},
  modalAction: {alignSelf: 'stretch', marginTop: 21, gap: 9},
  formGap: {gap: 20},
  group: {gap: 8},
  inputLabel: {fontSize: 14, fontWeight: '800', color: colors.ink},
  chipGrid: {flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, rowGap: 8},
  chipCell: {width: '33.333%', paddingHorizontal: 4},
  primaryToggleCard: {minHeight: 76, borderRadius: radii.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', padding: 13, gap: 11},
  primaryToggleIcon: {width: 42, height: 42, borderRadius: 15, backgroundColor: colors.mintSoft, alignItems: 'center', justifyContent: 'center'},
  primaryToggleTitle: {fontSize: 13, fontWeight: '900', color: colors.ink},
  primaryToggleText: {fontSize: 10, lineHeight: 14, color: colors.muted, marginTop: 2},
  bottomPush: {marginTop: 'auto', paddingTop: 24},
  selfScheduleHero: {minHeight: 92, borderRadius: radii.lg, backgroundColor: colors.tealDark, flexDirection: 'row', alignItems: 'center', padding: 16, gap: 13},
  selfScheduleIcon: {width: 54, height: 54, borderRadius: 19, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center'},
  scheduleHeroTitle: {fontSize: 16, fontWeight: '900', color: colors.white},
  scheduleHeroText: {fontSize: 10, lineHeight: 15, color: '#C6E8E3', marginTop: 4},
  scheduleSection: {marginTop: 20, gap: 10},
  scheduleDaysSection: {marginTop: 19, gap: 10},
  scheduleLabelRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  sectionLabel: {fontSize: 10, color: colors.muted, fontWeight: '900', letterSpacing: 1.1},
  twentyFourHourBadge: {fontSize: 9, fontWeight: '900', letterSpacing: 0.7, color: colors.tealDark, backgroundColor: colors.mintSoft, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9},
  reminderListHeader: {marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  reminderCards: {marginTop: 12, gap: 10},
  reminderCard: {minHeight: 86, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 11},
  reminderCardIcon: {width: 46, height: 46, borderRadius: 16, backgroundColor: colors.mintSoft, alignItems: 'center', justifyContent: 'center'},
  reminderCardTime: {fontSize: 23, lineHeight: 28, fontWeight: '900', color: colors.ink, fontVariant: ['tabular-nums']},
  reminderCardDays: {fontSize: 10, lineHeight: 15, color: colors.muted, marginTop: 2},
  reminderEditText: {fontSize: 10, fontWeight: '900', color: colors.teal},
  reminderEmptyCard: {minHeight: 205, borderRadius: radii.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#91D5C8', backgroundColor: colors.mintSoft, alignItems: 'center', justifyContent: 'center', padding: 24},
  reminderEmptyIcon: {width: 60, height: 60, borderRadius: 21, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center'},
  reminderEmptyTitle: {fontSize: 17, fontWeight: '900', color: colors.ink, marginTop: 13},
  reminderEmptyText: {maxWidth: 260, fontSize: 11, lineHeight: 17, color: colors.muted, textAlign: 'center', marginTop: 5},
  reminderAddAction: {marginTop: 'auto', paddingTop: 22},
  reminderEditorScreen: {flex: 1, paddingTop: 4, paddingBottom: 28},
  reminderEditorBackdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,34,47,0.58)'},
  reminderEditorSheet: {height: '86%', width: '100%', borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.cream, paddingHorizontal: 22, paddingTop: 9, paddingBottom: 28, shadowColor: '#001A21', shadowOpacity: 0.24, shadowRadius: 24, shadowOffset: {width: 0, height: -8}, elevation: 18},
  reminderSheetHandle: {width: 42, height: 5, borderRadius: 999, backgroundColor: '#C5CFCE', alignSelf: 'center', marginBottom: 3},
  reminderEditorHeader: {height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  reminderEditorCancel: {fontSize: 14, fontWeight: '800', color: colors.muted, paddingVertical: 8},
  reminderEditorTitle: {fontSize: 18, fontWeight: '900', color: colors.ink},
  reminderEditorDone: {fontSize: 14, fontWeight: '900', color: colors.teal, paddingVertical: 8},
  editorTitleBlock: {marginTop: 20, gap: 4},
  reminderEditorHint: {fontSize: 11, color: colors.muted},
  wheelClockCard: {height: 238, marginTop: 13, borderRadius: radii.xl, backgroundColor: '#EAF9F5', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', paddingHorizontal: 42, borderWidth: 1.5, borderColor: '#B9E7DB'},
  wheelMintGlow: {position: 'absolute', width: 190, height: 190, borderRadius: 95, left: -48, top: -72, backgroundColor: '#CFF5E8'},
  wheelSkyGlow: {position: 'absolute', width: 178, height: 178, borderRadius: 89, right: -55, bottom: -70, backgroundColor: '#DDF4F8'},
  wheelAmberDot: {position: 'absolute', width: 48, height: 48, borderRadius: 24, right: 22, top: 20, backgroundColor: '#FFE9B5', opacity: 0.82},
  wheelSelection: {position: 'absolute', left: 28, right: 28, top: 90, height: WHEEL_ITEM_HEIGHT, borderRadius: 17, backgroundColor: colors.white, borderWidth: 1.5, borderColor: '#79CDBE', shadowColor: colors.shadow, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: {width: 0, height: 4}, elevation: 3, zIndex: 1},
  wheelColumn: {width: 98, height: WHEEL_ITEM_HEIGHT * 3, zIndex: 2},
  wheelContent: {alignItems: 'stretch'},
  wheelSpacer: {height: WHEEL_ITEM_HEIGHT},
  wheelItem: {height: WHEEL_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center'},
  wheelValue: {fontSize: 23, lineHeight: 29, fontWeight: '700', color: '#79A6A4', fontVariant: ['tabular-nums']},
  wheelValueSelected: {fontSize: 31, color: colors.tealDark, fontWeight: '900'},
  wheelColon: {width: 34, textAlign: 'center', fontSize: 31, fontWeight: '900', color: colors.tealDark, zIndex: 3},
  editorRepeatCard: {marginTop: 20, borderRadius: radii.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 17},
  editorRepeatTitle: {fontSize: 15, fontWeight: '900', color: colors.ink},
  editorRepeatSummary: {fontSize: 10, color: colors.teal, fontWeight: '800', marginTop: 3},
  editorWeekdayRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  editorWeekday: {width: 34, height: 34, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center'},
  editorWeekdaySelected: {backgroundColor: colors.tealDark, borderColor: colors.tealDark},
  editorWeekdayText: {fontSize: 11, fontWeight: '900', color: colors.muted},
  editorWeekdayTextSelected: {color: colors.white},
  editorFooterNote: {marginTop: 14, minHeight: 58, borderRadius: radii.md, backgroundColor: colors.mintSoft, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10},
  editorFooterText: {flex: 1, fontSize: 10, lineHeight: 15, color: colors.muted},
  deleteReminderButton: {minHeight: 46, marginTop: 11, transform: [{translateY: -8}], borderRadius: radii.md, borderWidth: 1, borderColor: '#F0B8B3', backgroundColor: colors.coralSoft, alignItems: 'center', justifyContent: 'center'},
  deleteReminderText: {fontSize: 12, fontWeight: '900', color: colors.coral},
  editorError: {fontSize: 11, lineHeight: 16, color: colors.coral, fontWeight: '800', textAlign: 'center', marginTop: 11},
  clockList: {gap: 9},
  clockTimeCard: {minHeight: 84, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.teal, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8},
  clockIcon: {width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft},
  removeClockButton: {width: 34, height: 34, marginLeft: 'auto', borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.coralSoft},
  removeClockText: {fontSize: 22, lineHeight: 23, fontWeight: '800', color: colors.coral},
  addClockButton: {minHeight: 48, borderRadius: radii.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.teal, backgroundColor: colors.mintSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8},
  addClockPlus: {fontSize: 20, lineHeight: 21, fontWeight: '700', color: colors.tealDark},
  addClockText: {fontSize: 12, fontWeight: '900', color: colors.tealDark},
  selectEveryDay: {fontSize: 10, fontWeight: '900', color: colors.teal},
  weekdayRow: {flexDirection: 'row', justifyContent: 'space-between', gap: 5},
  weekdayChip: {flex: 1, aspectRatio: 1, maxWidth: 43, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center'},
  weekdayChipSelected: {backgroundColor: colors.tealDark, borderColor: colors.tealDark},
  weekdayText: {fontSize: 12, fontWeight: '900', color: colors.muted},
  weekdayTextSelected: {color: colors.white},
  selectedDaysText: {fontSize: 11, lineHeight: 16, color: colors.muted},
  simpleTimeCard: {minHeight: 88, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.teal, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 9},
  timeNumberGroup: {width: 66, gap: 4},
  compactInputLabel: {fontSize: 9, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6},
  timeNumberInput: {height: 48, borderRadius: 13, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, color: colors.ink, fontSize: 23, fontWeight: '900', textAlign: 'center', paddingVertical: 0},
  timeColon: {fontSize: 24, fontWeight: '900', color: colors.ink, marginTop: 17},
  periodToggle: {marginLeft: 'auto', borderRadius: 13, backgroundColor: colors.cream, padding: 3, gap: 2},
  periodButton: {minWidth: 48, minHeight: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center'},
  periodButtonSelected: {backgroundColor: colors.tealDark},
  periodText: {fontSize: 11, fontWeight: '900', color: colors.muted},
  periodTextSelected: {color: colors.white},
  scheduleControlsCard: {marginTop: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, padding: 15, gap: 14},
  stepperRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  stepperLabel: {fontSize: 13, fontWeight: '800', color: colors.ink},
  stepperControls: {flexDirection: 'row', alignItems: 'center', gap: 8},
  stepperButton: {width: 38, height: 38, borderRadius: 12, backgroundColor: colors.mintSoft, alignItems: 'center', justifyContent: 'center'},
  stepperButtonText: {fontSize: 23, lineHeight: 25, fontWeight: '700', color: colors.tealDark},
  stepperValueWrap: {minWidth: 68, alignItems: 'center'},
  stepperValue: {fontSize: 18, lineHeight: 21, fontWeight: '900', color: colors.ink},
  stepperSuffix: {fontSize: 9, lineHeight: 12, color: colors.muted},
  controlDivider: {height: 1, backgroundColor: colors.line},
  gapInputRow: {flexDirection: 'row', gap: 10, marginTop: 10},
  compactNumberWrap: {flex: 1, minHeight: 56, borderWidth: 1, borderColor: colors.line, borderRadius: 13, backgroundColor: colors.cream, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12},
  compactNumberInput: {minWidth: 48, flex: 1, paddingVertical: 0, color: colors.ink, fontSize: 18, fontWeight: '900'},
  compactNumberLabel: {fontSize: 10, color: colors.muted, fontWeight: '700'},
  scheduleError: {fontSize: 11, lineHeight: 16, color: colors.coral, fontWeight: '700'},
  scheduleSummaryCard: {marginTop: 14, minHeight: 62, borderRadius: radii.md, backgroundColor: colors.mintSoft, flexDirection: 'row', alignItems: 'center', padding: 13, gap: 11},
  scheduleSummaryTime: {fontSize: 14, fontWeight: '900', color: colors.ink},
  scheduleSummaryText: {fontSize: 10, lineHeight: 15, color: colors.muted, marginTop: 2},
  optionStack: {gap: 8},
  scheduleOption: {minHeight: 66, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: 'rgba(255,255,255,0.86)', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13},
  scheduleOptionSelected: {borderColor: colors.teal, backgroundColor: colors.mintSoft},
  radio: {width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ABC1C4', alignItems: 'center', justifyContent: 'center'},
  radioSelected: {borderColor: colors.teal},
  radioInner: {width: 10, height: 10, borderRadius: 5, backgroundColor: colors.teal},
  optionTitle: {fontSize: 14, fontWeight: '900', color: colors.ink},
  optionSub: {fontSize: 10, color: colors.muted, marginTop: 3},
  timeRow: {flexDirection: 'row', gap: 7},
  timeChip: {flex: 1, minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5},
  timeChipSelected: {backgroundColor: colors.tealDark, borderColor: colors.tealDark},
  timeText: {fontSize: 11, fontWeight: '800', color: colors.tealDark},
  timeTextSelected: {color: colors.white},
  timePickerField: {minHeight: 68, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.teal, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 12},
  timePickerIcon: {width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft},
  timePickerValue: {flex: 1, fontSize: 21, fontWeight: '900', color: colors.ink},
  timePickerChange: {fontSize: 12, fontWeight: '800', color: colors.teal},
  requirementWarning: {marginTop: 12, minHeight: 76, borderRadius: radii.md, borderWidth: 1, borderColor: '#EDC884', backgroundColor: colors.amberSoft, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13},
  requirementTitle: {fontSize: 13, fontWeight: '900', color: '#6D471A'},
  requirementText: {fontSize: 10, lineHeight: 15, color: '#8B6128', marginTop: 3},
  reminderFlowCard: {borderRadius: radii.md, backgroundColor: colors.amberSoft, padding: 14, marginTop: 17},
  reminderFlowTitle: {fontSize: 13, fontWeight: '900', color: colors.ink},
  reminderFlowText: {fontSize: 10, lineHeight: 16, color: colors.muted, marginTop: 4},
  recipientCard: {borderRadius: radii.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 14, marginTop: 11, flexDirection: 'row', alignItems: 'center', gap: 11},
  recipientTitle: {fontSize: 13, fontWeight: '900', color: colors.ink},
  recipientText: {fontSize: 10, color: colors.muted, marginTop: 3},
  circleSummary: {marginHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radii.lg, padding: 15, backgroundColor: colors.mintSoft, borderWidth: 1, borderColor: '#C5E9E1'},
  circleSummaryIcon: {width: 48, height: 48, borderRadius: 17, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center'},
  circleSummaryTitle: {fontSize: 15, fontWeight: '900', color: colors.ink},
  circleSummaryText: {fontSize: 10, lineHeight: 15, color: colors.muted, marginTop: 3},
  circleList: {padding: 22, gap: 10, flexGrow: 1},
  contactCard: {minHeight: 92, borderRadius: radii.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', padding: 13, gap: 12},
  primarySwitch: {alignItems: 'center', gap: 2},
  primarySwitchLabel: {fontSize: 8, letterSpacing: 0.7, fontWeight: '900', color: colors.muted},
  removeText: {fontSize: 10, fontWeight: '700', color: colors.coral, marginTop: 5},
  circleEmpty: {flex: 1, minHeight: 390, borderRadius: radii.xl, backgroundColor: 'rgba(255,255,255,0.86)', borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', padding: 22},
  emptyTitle: {fontSize: 20, fontWeight: '900', color: colors.ink, textAlign: 'center'},
  emptyText: {fontSize: 13, lineHeight: 19, color: colors.muted, textAlign: 'center', marginTop: 7, maxWidth: 275},
  emptyButton: {alignSelf: 'stretch', marginTop: 20},
  simpleHeader: {paddingHorizontal: 22, paddingTop: 10, paddingBottom: 18},
  settingsScroll: {flex: 1},
  settingsScrollContent: {paddingBottom: 12},
  profileCard: {marginHorizontal: 22, minHeight: 82, padding: 14, borderRadius: radii.lg, backgroundColor: colors.tealDark, flexDirection: 'row', alignItems: 'center', gap: 12},
  profileAvatar: {width: 50, height: 50, borderRadius: 18, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center'},
  profileName: {color: colors.white},
  profileMeta: {color: '#B9DDD9'},
  activePill: {borderRadius: 999, backgroundColor: '#D7F4EB', paddingHorizontal: 10, paddingVertical: 6},
  activePillText: {fontSize: 9, fontWeight: '900', letterSpacing: 0.8, color: colors.tealDark},
  settingsList: {marginHorizontal: 22, marginTop: 4, borderRadius: radii.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, overflow: 'hidden'},
  settingRow: {minHeight: 70, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line},
  settingRowPressed: {backgroundColor: colors.mintSoft},
  settingIcon: {width: 36, height: 36, borderRadius: 13, backgroundColor: colors.mintSoft, alignItems: 'center', justifyContent: 'center'},
  settingCopy: {flex: 1},
  settingTitle: {fontSize: 13, fontWeight: '800', color: colors.ink},
  settingSubtitle: {fontSize: 10, lineHeight: 14, color: colors.muted, marginTop: 2},
  logoutButton: {marginHorizontal: 22, marginTop: 14, minHeight: 54, borderRadius: radii.md, borderWidth: 1, borderColor: '#F2C3BE', backgroundColor: '#FFF8F7', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9},
  logoutButtonPressed: {backgroundColor: colors.coralSoft},
  logoutText: {fontSize: 13, fontWeight: '900', color: colors.coral},
  deleteAccountButton: {marginHorizontal: 22, marginTop: 8, minHeight: 62, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, opacity: 0.92},
  deleteAccountButtonPressed: {backgroundColor: '#FFF1EF'},
  deleteAccountTitle: {fontSize: 12, fontWeight: '900', color: colors.coral, textDecorationLine: 'underline'},
  deleteAccountText: {fontSize: 9, lineHeight: 13, color: colors.muted, marginTop: 3, textAlign: 'center'},
  familyLoading: {fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 34},
  familyHero: {borderRadius: radii.xl, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, alignItems: 'center', padding: 24},
  familyHeroIcon: {width: 58, height: 58, borderRadius: 20, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center'},
  familyHeroTitle: {fontSize: 21, fontWeight: '900', color: colors.ink, marginTop: 14},
  familyHeroText: {fontSize: 12, lineHeight: 18, color: colors.muted, textAlign: 'center', marginTop: 6},
  familyHeroButton: {alignSelf: 'stretch', marginTop: 18},
  familySummaryCard: {minHeight: 88, borderRadius: radii.lg, backgroundColor: colors.tealDark, padding: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  familySummaryTitle: {fontSize: 16, fontWeight: '900', color: colors.white},
  familySummaryText: {fontSize: 10, color: '#C6E8E3', marginTop: 5},
  familyCountPill: {width: 48, height: 48, borderRadius: 17, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center'},
  familyCountText: {fontSize: 14, fontWeight: '900', color: colors.tealDark},
  familyMemberCard: {minHeight: 72, marginTop: 10, borderRadius: radii.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', padding: 13, gap: 12},
  familyMemberNumber: {width: 38, height: 38, borderRadius: 13, backgroundColor: colors.mintSoft, alignItems: 'center', justifyContent: 'center'},
  familyMemberNumberText: {fontSize: 13, fontWeight: '900', color: colors.tealDark},
  familyMemberPhone: {fontSize: 14, fontWeight: '900', color: colors.ink},
  familyMemberLocked: {fontSize: 10, color: colors.muted, marginTop: 3},
  familyAddCard: {marginTop: 14, borderRadius: radii.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 15, gap: 12},
  familyLockNotice: {marginTop: 14, borderRadius: radii.md, borderWidth: 1, borderColor: '#F2C3BE', backgroundColor: colors.coralSoft, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9},
  familyLockText: {flex: 1, fontSize: 10, lineHeight: 15, color: '#7A4944'},
  legalTabs: {flexDirection: 'row', borderRadius: 16, padding: 4, backgroundColor: '#E4ECEB', marginBottom: 16},
  legalTab: {flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8},
  legalTabSelected: {backgroundColor: colors.white, shadowColor: colors.shadow, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: {width: 0, height: 2}, elevation: 2},
  legalTabText: {fontSize: 12, fontWeight: '800', color: colors.muted},
  legalTabTextSelected: {color: colors.tealDark},
  legalIntro: {minHeight: 108, borderRadius: radii.xl, backgroundColor: colors.tealDark, flexDirection: 'row', alignItems: 'center', gap: 13, padding: 17},
  legalIntroIcon: {width: 50, height: 50, borderRadius: 18, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center'},
  legalIntroTitle: {fontSize: 16, lineHeight: 21, fontWeight: '900', color: colors.white},
  legalIntroText: {fontSize: 11, lineHeight: 16, color: '#C6E8E3', marginTop: 4},
  legalNotice: {marginTop: 14, borderRadius: radii.md, borderWidth: 1, borderColor: '#EDC884', backgroundColor: colors.amberSoft, padding: 14},
  legalNoticeTitle: {fontSize: 12, fontWeight: '900', color: '#6D471A'},
  legalNoticeText: {fontSize: 11, lineHeight: 17, color: '#7D592A', marginTop: 4},
  legalSection: {marginTop: 12, borderRadius: radii.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 16},
  legalSectionTitle: {fontSize: 15, lineHeight: 20, fontWeight: '900', color: colors.ink, marginBottom: 7},
  legalBody: {fontSize: 12, lineHeight: 19, color: colors.muted, marginTop: 5},
  legalBulletRow: {flexDirection: 'row', gap: 9, marginTop: 8, paddingRight: 2},
  legalBullet: {width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal, marginTop: 7},
  legalBulletText: {flex: 1, fontSize: 12, lineHeight: 19, color: colors.muted},
});
