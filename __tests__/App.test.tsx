/**
 * @format
 */

import React from 'react';
import {Alert, BackHandler, ScrollView, Switch, Text} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactTestRenderer from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import App from '../App';
import DinDinApp from '../src/DinDinApp';
import {SubscriptionScreen} from '../src/screens/AuthScreens';
import {FamilyMembersScreen, HomeScreen, ScheduleScreen, SettingsScreen} from '../src/screens/MainScreens';

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const initialMetrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 44, left: 0, right: 0, bottom: 34},
};

async function renderRegisteredApp({subscribed = true}: {subscribed?: boolean} = {}) {
  storage.getItem.mockImplementation(async key => {
    if (key === '@dindin/session') return 'registered';
    if (key === '@dindin/subscription') return subscribed ? 'active' : null;
    if (key === '@dindin/safety-setup') return 'complete';
    if (key === '@dindin/profile') return 'Aman';
    if (key === '@dindin/auth') {
      return JSON.stringify({
        userId: 'user-test',
        token: 'token-test',
        phone: '+919999999999',
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
    }
    return null;
  });

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <DinDinApp />
      </SafeAreaProvider>,
    );
    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve();
    }
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(700);
      for (let tick = 0; tick < 6; tick += 1) {
        await Promise.resolve();
      }
    });
    if (renderer!.root.findAllByProps({testID: 'tab-settings'}).length > 0) {
      break;
    }
  }
  if (renderer!.root.findAllByProps({testID: 'tab-settings'}).length === 0) {
    throw new Error(`Registered app did not reach Home: ${JSON.stringify(renderer!.toJSON()).slice(0, 800)}`);
  }
  return renderer!;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      items: [],
      schedule: null,
      preferences: {
        notifications: true,
        sounds: true,
        vibration: true,
        safetyLocation: true,
      },
    }),
  })) as jest.Mock;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('renders correctly', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });
  expect(renderer!.toJSON()).toBeTruthy();
  ReactTestRenderer.act(() => renderer!.unmount());
});

test('hardware back walks privacy to settings to home, then allows exit', async () => {
  let hardwareBack = () => false;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    hardwareBack = () => handler({} as never) ?? false;
    return {remove: jest.fn()};
  });
  const renderer = await renderRegisteredApp();

  ReactTestRenderer.act(() => {
    renderer.root.findByProps({testID: 'tab-settings'}).props.onPress();
  });
  ReactTestRenderer.act(() => {
    renderer.root.findByProps({testID: 'setting-privacy'}).props.onPress();
  });
  expect(renderer.root.findAllByProps({accessibilityLabel: 'Go back'}).length).toBeGreaterThan(0);
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Privacy Policy')).toBe(true);
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Terms & Conditions')).toBe(true);

  let handled = false;
  ReactTestRenderer.act(() => {
    handled = hardwareBack();
  });
  expect(handled).toBe(true);
  expect(renderer.root.findByProps({testID: 'tab-settings'}).props.accessibilityState.selected).toBe(true);

  ReactTestRenderer.act(() => {
    handled = hardwareBack();
  });
  expect(handled).toBe(true);
  expect(renderer.root.findByProps({testID: 'tab-home'}).props.accessibilityState.selected).toBe(true);
  expect(hardwareBack()).toBe(false);

  ReactTestRenderer.act(() => renderer.unmount());
}, 20_000);

test('settings toggles persist to local storage', async () => {
  const renderer = await renderRegisteredApp();
  ReactTestRenderer.act(() => {
    renderer.root.findByProps({testID: 'tab-settings'}).props.onPress();
  });
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Reminder')).toBe(true);
  expect(renderer.root.findAllByProps({testID: 'setting-location'})).toHaveLength(0);
  expect(renderer.root.findAllByProps({testID: 'setting-whatsapp'})).toHaveLength(0);
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Reset development preview')).toBe(false);
  const alertRow = renderer.root.findByProps({testID: 'setting-alerts'});
  const toggle = alertRow.findByType(Switch);
  await ReactTestRenderer.act(async () => {
    toggle.props.onValueChange(false);
    await Promise.resolve();
  });

  expect(storage.setItem).toHaveBeenCalledWith(
    '@dindin/preferences',
    JSON.stringify({
      notifications: false,
      sounds: true,
      vibration: true,
      safetyLocation: true,
    }),
  );
  ReactTestRenderer.act(() => renderer.unmount());
});

test('turning Reminder off pauses the active server schedule', async () => {
  const serverSchedule = {
    id: 'self-schedule-1',
    times: ['18:00'],
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    reminders: [{id: 'evening', time: '18:00', weekdays: [0, 1, 2, 3, 4, 5, 6]}],
    timezone: 'Asia/Kolkata',
    nextRunAt: '2099-01-01T12:30:00.000Z',
    status: 'scheduled',
    stage: 0,
    active: true,
  };
  (globalThis.fetch as jest.Mock).mockImplementation(async (input: string, init?: RequestInit) => {
    const isActiveUpdate = input.includes('/self-check-in/active');
    const payload = isActiveUpdate
      ? {schedule: {...serverSchedule, active: false}}
      : input.includes('/preferences')
        ? {preferences: {notifications: true, sounds: true, vibration: true, safetyLocation: true}}
        : input.includes('/self-check-in')
          ? {schedule: serverSchedule}
          : {items: [{id: 'primary-1', name: 'Mum', relationship: 'Family', phone: '+919111111111', primary: true}]};
    return {ok: true, status: 200, json: async () => payload, request: init};
  });
  const renderer = await renderRegisteredApp();
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Reminder is on')).toBe(true);
  ReactTestRenderer.act(() => renderer.root.findByProps({testID: 'tab-settings'}).props.onPress());
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({testID: 'setting-alerts'}).findByType(Switch).props.onValueChange(false);
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  const activeCall = (globalThis.fetch as jest.Mock).mock.calls.find(([url]) =>
    String(url).includes('/v1/self-check-in/active'),
  );
  expect(activeCall).toBeTruthy();
  expect(JSON.parse(activeCall![1].body)).toEqual({active: false});
  ReactTestRenderer.act(() => renderer.root.findByProps({testID: 'tab-home'}).props.onPress());
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Your reminder is off')).toBe(true);
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'REMINDER OFF')).toBe(true);
  ReactTestRenderer.act(() => renderer.unmount());
});

test('an entitled user with Reminder enabled resumes a server-paused schedule', async () => {
  const pausedSchedule = {
    id: 'self-schedule-paused',
    times: ['11:32'],
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    reminders: [{id: 'late-morning', time: '11:32', weekdays: [0, 1, 2, 3, 4, 5, 6]}],
    timezone: 'Asia/Kolkata',
    nextRunAt: '2099-01-01T06:02:00.000Z',
    status: 'scheduled',
    stage: 0,
    active: false,
  };
  (globalThis.fetch as jest.Mock).mockImplementation(async (input: string, init?: RequestInit) => {
    const payload = input.includes('/self-check-in/active')
      ? {schedule: {...pausedSchedule, active: true}}
      : input.includes('/preferences')
        ? {preferences: {notifications: true, sounds: true, vibration: true, safetyLocation: true}}
        : input.includes('/self-check-in')
          ? {schedule: pausedSchedule}
          : {items: []};
    return {ok: true, status: 200, json: async () => payload, request: init};
  });

  const renderer = await renderRegisteredApp();
  const resumeCall = (globalThis.fetch as jest.Mock).mock.calls.find(([url, init]) =>
    String(url).includes('/v1/self-check-in/active') &&
    JSON.parse(String((init as RequestInit | undefined)?.body || '{}')).active === true,
  );
  expect(resumeCall).toBeTruthy();
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Reminder is on')).toBe(true);
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'REMINDER OFF')).toBe(false);
  ReactTestRenderer.act(() => renderer.unmount());
});

test('authenticated app restores My Circle contacts from PostgreSQL API data', async () => {
  (globalThis.fetch as jest.Mock).mockImplementation(async (input: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      input.includes('/preferences')
        ? {
            preferences: {
              notifications: true,
              sounds: true,
              vibration: true,
              safetyLocation: true,
            },
          }
        : input.includes('/self-check-in')
          ? {schedule: null}
        : {
            items: [
              {
                id: 'contact-neon',
                name: 'Mum',
                relationship: 'Mom',
                phone: '+919888888888',
                primary: true,
              },
            ],
          },
  }));
  const renderer = await renderRegisteredApp();
  await ReactTestRenderer.act(async () => {
    for (let tick = 0; tick < 8; tick += 1) {
      await Promise.resolve();
    }
  });

  expect(
    renderer.root.findAllByType(Text).some(node => node.props.children === 'Mum'),
  ).toBe(false);
  ReactTestRenderer.act(() => {
    renderer.root.findByProps({testID: 'tab-circle'}).props.onPress();
  });
  expect(
    renderer.root.findAllByType(Text).some(node => node.props.children === 'Mum'),
  ).toBe(true);
  expect(storage.setItem).toHaveBeenCalledWith(
    '@dindin/contacts',
    expect.stringContaining('contact-neon'),
  );
  ReactTestRenderer.act(() => renderer.unmount());
});

test('home shows every configured reminder instead of circle contacts', () => {
  const addReminder = jest.fn();
  const editReminder = jest.fn();
  let renderer: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <HomeScreen
          name="Aman"
          schedule={{
            id: 'schedule-home',
            times: ['08:30', '19:45'],
            weekdays: [0, 1, 2, 3, 4, 5, 6],
            reminders: [
              {id: 'morning', time: '08:30', weekdays: [1, 2, 3, 4, 5]},
              {id: 'evening', time: '19:45', weekdays: [0, 6]},
            ],
            timezone: 'Asia/Kolkata',
            nextRunAt: '2099-01-01T03:00:00.000Z',
            status: 'scheduled',
            stage: 0,
            active: true,
          }}
          reminderEnabled
          acknowledging={false}
          escalating={false}
          onManageReminders={jest.fn()}
          onAddReminder={addReminder}
          onEditReminder={editReminder}
          onAcknowledge={jest.fn()}
          onNotOkay={jest.fn()}
          onTab={jest.fn()}
        />
      </SafeAreaProvider>,
    );
  });

  expect(renderer!.root.findAllByProps({testID: 'home-reminder-morning'}).length).toBeGreaterThan(0);
  expect(renderer!.root.findAllByProps({testID: 'home-reminder-evening'}).length).toBeGreaterThan(0);
  ReactTestRenderer.act(() => {
    renderer!.root.findAllByProps({testID: 'home-add-reminder'})
      .find(node => typeof node.props.onPress === 'function')!.props.onPress();
  });
  expect(addReminder).toHaveBeenCalledTimes(1);
  ReactTestRenderer.act(() => {
    renderer!.root.findAllByProps({testID: 'home-reminder-morning'})
      .find(node => typeof node.props.onPress === 'function')!.props.onPress();
  });
  expect(editReminder).toHaveBeenCalledWith('morning');
  ReactTestRenderer.act(() => renderer!.unmount());
});

test('settings only shows safety location when Always access is not enabled', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <SettingsScreen
          preferences={{notifications: true, sounds: true, vibration: true, safetyLocation: false}}
          onPreferencesChange={jest.fn()}
          onSafetyLocation={jest.fn()}
          onPrivacy={jest.fn()}
          onManageBilling={jest.fn()}
          onFamily={jest.fn()}
          onLogout={jest.fn()}
          onDeleteAccount={jest.fn()}
          deletingAccount={false}
          onTab={jest.fn()}
        />
      </SafeAreaProvider>,
    );
    await Promise.resolve();
  });
  expect(renderer!.root.findAllByProps({testID: 'setting-location'}).length).toBeGreaterThan(0);
  expect(renderer!.root.findAllByProps({testID: 'setting-whatsapp'})).toHaveLength(0);
  expect(renderer!.root.findAllByProps({testID: 'setting-logout'}).length).toBeGreaterThan(0);
  expect(renderer!.root.findAllByProps({testID: 'setting-delete-account'}).length).toBeGreaterThan(0);
  ReactTestRenderer.act(() => renderer!.unmount());
});

test('family screen shows permanently assigned slots and capacity', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <FamilyMembersScreen
          family={{
            role: 'owner',
            active: true,
            capacity: 3,
            members: [{
              id: 'member-1',
              phone: '+919876543210',
              createdAt: '2026-10-31T10:00:00.000Z',
            }],
          }}
          ownerPhone="+919999999999"
          loading={false}
          adding={false}
          onBack={jest.fn()}
          onAdd={jest.fn(async () => undefined)}
          onChoosePlan={jest.fn()}
        />
      </SafeAreaProvider>,
    );
    await Promise.resolve();
  });
  const copy = renderer!.root.findAllByType(Text).map(node => node.props.children).flat().join(' ');
  expect(copy).toMatch(/2\s+of\s+3\s+accounts covered/);
  expect(copy).toContain('+919999999999');
  expect(copy).toContain('Plan purchaser');
  expect(copy).toContain('Permanently assigned');
  expect(copy).toContain('cannot be edited, removed, or replaced');
  ReactTestRenderer.act(() => renderer!.unmount());
});

test('a full family plan offers the next valid capacity upgrade', async () => {
  const onChoosePlan = jest.fn();
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <FamilyMembersScreen
          family={{
            role: 'owner',
            active: true,
            capacity: 3,
            members: [
              {id: 'member-1', phone: '+919876543210', createdAt: '2026-10-31T10:00:00.000Z'},
              {id: 'member-2', phone: '+919876543211', createdAt: '2026-10-31T10:01:00.000Z'},
            ],
          }}
          ownerPhone="+919999999999"
          loading={false}
          adding={false}
          onBack={jest.fn()}
          onAdd={jest.fn(async () => undefined)}
          onChoosePlan={onChoosePlan}
        />
      </SafeAreaProvider>,
    );
    await Promise.resolve();
  });
  const button = renderer!.root.findAll(node =>
    typeof node.props.onPress === 'function' &&
    node.findAllByType(Text).some(text => text.props.children === 'Upgrade to add another member'),
  )[0];
  expect(button).toBeDefined();
  ReactTestRenderer.act(() => button.props.onPress());
  expect(onChoosePlan).toHaveBeenCalledWith(4);
  ReactTestRenderer.act(() => renderer!.unmount());
});

test('reminder list edits one clock without changing another reminder days', async () => {
  let finishSave: (value: boolean) => void = () => {};
  const saveResult = new Promise<boolean>(resolve => { finishSave = resolve; });
  const onSave = jest.fn().mockReturnValue(saveResult);
  const onEditorRequestHandled = jest.fn();
  const schedule = {
    id: 'schedule-1',
    reminders: [
      {id: 'morning', time: '09:15', weekdays: [1 as const]},
      {id: 'evening', time: '18:00', weekdays: [0 as const]},
    ],
    timezone: 'Asia/Kolkata',
    nextRunAt: '2099-01-01T03:45:00.000Z',
    status: 'scheduled' as const,
    stage: 0 as const,
    active: true,
  };
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <ScheduleScreen
          schedule={schedule}
          primaryContactCount={1}
          safetyLocationEnabled
          saving={false}
          editorRequest={{key: 1, reminderId: 'morning'}}
          onBack={jest.fn()}
          onAddContact={jest.fn()}
          onEnableLocation={jest.fn()}
          onEditorRequestHandled={onEditorRequestHandled}
          onRequestEditor={jest.fn()}
          onDelete={jest.fn().mockResolvedValue(true)}
          onSave={onSave}
        />
      </SafeAreaProvider>,
    );
    await Promise.resolve();
  });
  expect(onEditorRequestHandled).toHaveBeenCalledWith(1);
  ReactTestRenderer.act(() => {
    const wheel = renderer!.root.findByProps({testID: 'reminder-hour-wheel'}).findByType(ScrollView);
    wheel.props.onScroll({nativeEvent: {contentOffset: {y: 12 * 58}}});
    wheel.props.onScrollEndDrag();
    wheel.props.onMomentumScrollBegin();
    wheel.props.onScroll({nativeEvent: {contentOffset: {y: 17 * 58}}});
    wheel.props.onMomentumScrollEnd({nativeEvent: {contentOffset: {y: 17 * 58}}});
    jest.advanceTimersByTime(200);
  });
  ReactTestRenderer.act(() => {
    renderer!.root.findByProps({testID: 'editor-weekday-3'}).props.onPress();
  });
  let saveTask: Promise<void>;
  ReactTestRenderer.act(() => {
    saveTask = renderer!.root.findByProps({testID: 'save-reminder-editor'}).props.onPress();
  });
  const savingLabels = renderer!.root.findAllByType(Text).map(node => String(node.props.children));
  expect(savingLabels).toContain('Saving...');
  expect(savingLabels).toContain('Delete reminder');
  expect(savingLabels).not.toContain('Deleting...');
  await ReactTestRenderer.act(async () => {
    finishSave(true);
    await saveTask!;
  });
  expect(onSave).toHaveBeenCalledWith({
    reminders: [
      {id: 'morning', time: '17:15', weekdays: [1, 3]},
      {id: 'evening', time: '18:00', weekdays: [0]},
    ],
  });
  ReactTestRenderer.act(() => renderer!.unmount());
});

test('an existing reminder can be deleted after confirmation', async () => {
  let finishDelete: (value: boolean) => void = () => {};
  const deleteResult = new Promise<boolean>(resolve => { finishDelete = resolve; });
  const onDelete = jest.fn().mockReturnValue(deleteResult);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <ScheduleScreen
          schedule={{
            id: 'schedule-1',
            reminders: [{id: 'morning', time: '09:15', weekdays: [1]}],
            timezone: 'Asia/Kolkata',
            nextRunAt: '2099-01-01T03:45:00.000Z',
            status: 'scheduled',
            stage: 0,
            active: true,
          }}
          primaryContactCount={1}
          safetyLocationEnabled
          saving={false}
          editorRequest={{key: 1, reminderId: 'morning'}}
          onBack={jest.fn()}
          onAddContact={jest.fn()}
          onEnableLocation={jest.fn()}
          onEditorRequestHandled={jest.fn()}
          onRequestEditor={jest.fn()}
          onDelete={onDelete}
          onSave={jest.fn().mockResolvedValue(true)}
        />
      </SafeAreaProvider>,
    );
    await Promise.resolve();
  });
  ReactTestRenderer.act(() => {
    renderer!.root.findByProps({testID: 'delete-reminder-editor'}).props.onPress();
  });
  expect(alert).toHaveBeenCalledWith(
    'Delete reminder?',
    '09:15 will be removed from your schedule.',
    expect.any(Array),
  );
  const buttons = alert.mock.calls[0][2] as Array<{text: string; onPress?: () => void | Promise<void>}>;
  let deleteTask: void | Promise<void>;
  ReactTestRenderer.act(() => {
    deleteTask = buttons.find(button => button.text === 'Delete')?.onPress?.();
  });
  const deletingLabels = renderer!.root.findAllByType(Text).map(node => String(node.props.children));
  expect(deletingLabels).toContain('Deleting...');
  expect(deletingLabels).toContain('Done');
  expect(deletingLabels).not.toContain('Saving...');
  await ReactTestRenderer.act(async () => {
    finishDelete(true);
    await deleteTask;
  });
  expect(onDelete).toHaveBeenCalledWith('morning');
  expect(renderer!.root.findAllByProps({testID: 'delete-reminder-editor'})).toHaveLength(0);
  ReactTestRenderer.act(() => renderer!.unmount());
});

test('an expired user can use the app but Add reminder opens Premium', async () => {
  const renderer = await renderRegisteredApp({subscribed: false});
  ReactTestRenderer.act(() => renderer.root.findByProps({testID: 'manage-reminders'}).props.onPress());
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({testID: 'add-reminder'}).props.onPress();
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Din Din Premium')).toBe(true);
  expect(renderer.root.findAllByType(Text).some(node =>
    String(node.props.children).includes('development preview'),
  )).toBe(true);
  expect(renderer.root.findAllByProps({testID: 'save-reminder-editor'})).toHaveLength(0);
  ReactTestRenderer.act(() => renderer.unmount());
});

test('subscription screen exposes a debug-only development preview bypass', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <SubscriptionScreen
          onActivated={jest.fn()}
          onDevelopmentPreview={jest.fn()}
        />
      </SafeAreaProvider>,
    );
    await Promise.resolve();
  });
  expect(
    renderer!.root.findAllByType(Text).some(node =>
      String(node.props.children).toLowerCase().includes('development preview'),
    ),
  ).toBe(true);
  const text = renderer!.root.findAllByType(Text).map(node => String(node.props.children));
  expect(text).toContain('₹350 / month');
  expect(text).toContain('₹3,200 / year');
  expect(text).toContain('₹6,000 once');
  expect(text).not.toContain('6 months');
  ReactTestRenderer.act(() => renderer!.unmount());
});

test('family purchase flow opens at the required capacity and shows matching prices', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <SubscriptionScreen
          onActivated={jest.fn()}
          onDevelopmentPreview={jest.fn()}
          initialPlanGroup="family"
          minimumFamilyCapacity={5}
        />
      </SafeAreaProvider>,
    );
    await Promise.resolve();
  });
  const text = renderer!.root.findAllByType(Text).map(node => String(node.props.children));
  expect(text).toContain('₹1,250 / month');
  expect(text).toContain('₹15,000 / year');
  expect(text).toContain('₹32,500 once');
  expect(renderer!.root.findAllByProps({accessibilityLabel: '3 covered accounts'})).toHaveLength(0);
  expect(renderer!.root.findAllByProps({accessibilityLabel: '5 covered accounts'}).length).toBeGreaterThan(0);
  ReactTestRenderer.act(() => renderer!.unmount());
});
