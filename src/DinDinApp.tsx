import notifee from '@notifee/react-native';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
  Animated,
  AppState,
  BackHandler,
  Linking,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {FloatingMascot} from './components/ui';
import {DEVELOPMENT_PREVIEW_ENABLED} from './config';
import type {
  AppPreferences,
  DraftContact,
  EmergencyContact,
  FamilyPlan,
  ReminderScheduleValues,
  ScreenName,
  SelfCheckInSchedule,
} from './models';
import {defaultPreferences} from './models';
import {
  OtpScreen,
  RegisterScreen,
  SafetySetupScreen,
  SubscriptionScreen,
  WelcomeScreen,
} from './screens/AuthScreens';
import {
  AddContactScreen,
  CircleScreen,
  FamilyMembersScreen,
  HomeScreen,
  PrivacySettingsScreen,
  ScheduleScreen,
  SettingsScreen,
} from './screens/MainScreens';
import {
  createContact,
  addFamilyPlanMember,
  deleteAccountOnServer,
  deleteContact,
  deleteSelfCheckInSchedule,
  fetchBillingEntitlement,
  fetchContacts,
  fetchFamilyPlan,
  fetchPreferencesFromServer,
  fetchSelfCheckIn,
  logoutOnServer,
  requestRegistrationOtp,
  savePreferencesOnServer,
  saveSelfCheckInSchedule,
  setSelfCheckInActive,
  updateContact,
  verifyOtpRegistration,
} from './services/checkIns';
import {
  captureAndReportSafetyLocation,
  hasAndroidBackgroundLocationPermission,
  openSafetyLocationSettings,
  requestSafetyLocationPermission,
} from './services/location';
import {
  handleReminderEvent,
  clearNativeSafetyLocationConfiguration,
  openExactAlarmSettings,
  processPendingNativeReminderActions,
  requestReminderPermission,
  respondToReminder,
  retryPendingReminderResponses,
  stopActiveReminderAlert,
  syncReminderNotifications,
} from './services/reminders';
import {startPushNotifications} from './services/push';
import {
  clearLocalData,
  clearSubscription,
  clearSubscriptionPreview,
  readAuthSession,
  readContacts,
  readPreferences,
  readProfile,
  readSelfSchedule,
  readSession,
  readSafetySetup,
  readSubscription,
  readSubscriptionPreview,
  saveAuthSession,
  saveContacts,
  savePreferences,
  saveProfile,
  saveSelfSchedule,
  saveSession,
  saveSafetySetup,
  saveSubscription,
  saveSubscriptionPreview,
} from './services/storage';
import {colors} from './theme';

export default function DinDinApp() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [entitled, setEntitled] = useState(false);
  const [developmentPreview, setDevelopmentPreview] = useState(false);
  const [subscriptionVisible, setSubscriptionVisible] = useState(false);
  const [familyPlanMinimum, setFamilyPlanMinimum] = useState(3);
  const [subscriptionFamilyMode, setSubscriptionFamilyMode] = useState(false);
  const [pendingReminderAction, setPendingReminderAction] = useState<{reminderId?: string} | null>(null);
  const [reminderEditorRequest, setReminderEditorRequest] = useState<{key: number; reminderId?: string} | null>(null);
  const [screen, setScreen] = useState<ScreenName>('welcome');
  const [history, setHistory] = useState<ScreenName[]>([]);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [familyPlan, setFamilyPlan] = useState<FamilyPlan | null>(null);
  const [familyLoading, setFamilyLoading] = useState(false);
  const [addingFamilyMember, setAddingFamilyMember] = useState(false);
  const [schedule, setSchedule] = useState<SelfCheckInSchedule | null>(null);
  const [savingContact, setSavingContact] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [enablingLocation, setEnablingLocation] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [backgroundLocationReady, setBackgroundLocationReady] = useState(
    Platform.OS !== 'android',
  );
  const [preferences, setPreferences] = useState<AppPreferences>(defaultPreferences);
  const preferencesRef = useRef(preferences);
  const scheduleRef = useRef<SelfCheckInSchedule | null>(null);
  const entitlementRef = useRef(false);
  const notificationSignatureRef = useRef('');

  const navigate = useCallback(
    (next: ScreenName) => {
      if (screen === next) return;
      setHistory(previous => [...previous, screen]);
      setScreen(next);
    },
    [screen],
  );

  const navigateRoot = useCallback((next: ScreenName) => {
    setHistory([]);
    setScreen(next);
  }, []);

  const goBack = useCallback(() => {
    if (history.length === 0) return false;
    const previous = history[history.length - 1];
    setHistory(items => items.slice(0, -1));
    setScreen(previous);
    return true;
  }, [history]);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  useEffect(() => {
    Promise.all([
      readSession(),
      readSubscription(),
      readSubscriptionPreview(),
      readProfile(),
      readContacts(),
      readSelfSchedule(),
      readPreferences(),
      readAuthSession(),
      readSafetySetup(),
    ])
      .then(async ([registered, subscribed, preview, profile, storedContacts, storedSchedule, storedPreferences, auth, safetySetup]) => {
        if (registered && !auth) {
          clearLocalData().catch(() => undefined);
          setAuthenticated(false);
          setScreen('welcome');
          return;
        }
        const effectivePreview = DEVELOPMENT_PREVIEW_ENABLED && preview;
        let accessAllowed = subscribed || effectivePreview;
        if (registered && auth && !effectivePreview) {
          try {
            const remoteEntitlement = await fetchBillingEntitlement();
            accessAllowed = remoteEntitlement.active;
            if (accessAllowed) await saveSubscription();
            else await clearSubscription();
          } catch {
            // Keep the last verified local entitlement while temporarily offline.
          }
        }
        setName(profile);
        setDevelopmentPreview(effectivePreview);
        setEntitled(accessAllowed);
        entitlementRef.current = accessAllowed;
        setPhone(auth?.phone ?? '');
        setContacts(storedContacts);
        setSchedule(storedSchedule);
        scheduleRef.current = storedSchedule;
        setPreferences(storedPreferences);
        setAuthenticated(Boolean(auth));
        setScreen(
          registered && auth
            ? safetySetup
              ? 'home'
              : 'safety-setup'
            : 'welcome',
        );
      })
      .catch(() => setScreen('welcome'))
      .finally(() => setTimeout(() => setReady(true), 650));
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => subscription.remove();
  }, [goBack]);

  const syncNotifications = useCallback(async (
    next: SelfCheckInSchedule | null,
    nextPreferences: AppPreferences,
    force = false,
  ) => {
    const allowed = entitlementRef.current;
    const signature = JSON.stringify({
      id: next?.id,
      nextRunAt: next?.nextRunAt,
      reminders: next?.reminders,
      active: next?.active,
      allowed,
      notifications: nextPreferences.notifications,
      sounds: nextPreferences.sounds,
      vibration: nextPreferences.vibration,
    });
    if (!force && notificationSignatureRef.current === signature) return;
    await syncReminderNotifications(allowed ? next : null, nextPreferences);
    notificationSignatureRef.current = signature;
  }, []);

  const persistSchedule = useCallback(async (next: SelfCheckInSchedule | null) => {
    setSchedule(next);
    scheduleRef.current = next;
    await saveSelfSchedule(next);
    await syncNotifications(next, preferencesRef.current);
  }, [syncNotifications]);

  const synchronize = useCallback(async () => {
    if (!authenticated) return;
    await processPendingNativeReminderActions();
    await retryPendingReminderResponses();
    const [remoteContacts, fetchedSchedule] = await Promise.all([
      fetchContacts(),
      fetchSelfCheckIn(),
    ]);
    let remoteSchedule = fetchedSchedule;
    if (
      remoteSchedule &&
      !remoteSchedule.active &&
      preferencesRef.current.notifications &&
      entitlementRef.current
    ) {
      remoteSchedule = await setSelfCheckInActive(true);
    }
    setContacts(remoteContacts);
    setSchedule(remoteSchedule);
    scheduleRef.current = remoteSchedule;
    await Promise.all([
      saveContacts(remoteContacts),
      saveSelfSchedule(remoteSchedule),
      syncNotifications(remoteSchedule, preferencesRef.current),
    ]);
    if (
      remoteSchedule?.status === 'waiting-first' ||
      remoteSchedule?.status === 'waiting-second'
    ) {
      navigateRoot('home');
    }
  }, [authenticated, navigateRoot, syncNotifications]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        if (!cancelled) await synchronize();
      } catch {
        // Cached contacts and reminder stay available while temporarily offline.
      }
    };
    refresh();
    const interval = setInterval(refresh, 15_000);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      appState.remove();
    };
  }, [authenticated, ready, synchronize]);

  useEffect(() => {
    if (!ready || !authenticated || developmentPreview) return;
    const refreshEntitlement = async () => {
      try {
        const entitlement = await fetchBillingEntitlement();
        if (entitlement.active) {
          setEntitled(true);
          entitlementRef.current = true;
          await saveSubscription();
        } else {
          setEntitled(false);
          entitlementRef.current = false;
          await clearSubscription();
          await syncNotifications(null, preferencesRef.current, true);
        }
      } catch {
        // Never lock a paid user out solely because the device is temporarily offline.
      }
    };
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') refreshEntitlement();
    });
    return () => appState.remove();
  }, [authenticated, developmentPreview, ready, syncNotifications]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let active = true;
    const refresh = () => {
      hasAndroidBackgroundLocationPermission()
        .then(granted => {
          if (active) setBackgroundLocationReady(granted);
        })
        .catch(() => {
          if (active) setBackgroundLocationReady(false);
        });
    };
    refresh();
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => {
      active = false;
      appState.remove();
    };
  }, [authenticated, ready]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    fetchPreferencesFromServer()
      .then(async remotePreferences => {
        preferencesRef.current = remotePreferences;
        setPreferences(remotePreferences);
        await savePreferences(remotePreferences);
        await syncNotifications(scheduleRef.current, remotePreferences);
      })
      .catch(() => undefined);
  }, [authenticated, ready, syncNotifications]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let disposed = false;
    let stop = () => {};
    startPushNotifications()
      .then(unsubscribe => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(error => {
        console.warn('Could not start Din Din push notifications', error);
      });
    return () => {
      disposed = true;
      stop();
    };
  }, [authenticated, ready]);

  useEffect(() => {
    if (!authenticated) return;
    return notifee.onForegroundEvent(async event => {
      try {
        const updated = await handleReminderEvent(event);
        if (updated) {
          await persistSchedule(updated);
          navigateRoot('home');
        }
      } catch (error) {
        Alert.alert(
          'Could not confirm check-in',
          error instanceof Error ? error.message : 'Please open Din Din and try again.',
        );
      }
    });
  }, [authenticated, navigateRoot, persistSchedule]);

  const handleTab = useCallback(
    (tab: 'home' | 'circle' | 'settings') => {
      if (tab === 'home') {
        navigateRoot('home');
        return;
      }
      setHistory(['home']);
      setScreen(tab);
    },
    [navigateRoot],
  );

  const updatePreferences = useCallback(
    (next: AppPreferences) => {
      const previous = preferencesRef.current;
      if (!previous.notifications && next.notifications && !entitlementRef.current) {
        setPendingReminderAction({});
        setSubscriptionFamilyMode(false);
        setSubscriptionVisible(true);
        return;
      }
      const previousSchedule = scheduleRef.current;
      preferencesRef.current = next;
      setPreferences(next);
      (async () => {
        let nextSchedule = previousSchedule;
        try {
          if (previous.notifications !== next.notifications && previousSchedule) {
            nextSchedule = await setSelfCheckInActive(next.notifications);
            scheduleRef.current = nextSchedule;
            setSchedule(nextSchedule);
            await saveSelfSchedule(nextSchedule);
          }
          if (!next.notifications) await stopActiveReminderAlert();
          await Promise.all([
            savePreferences(next),
            savePreferencesOnServer(next),
          ]);
          await syncNotifications(nextSchedule, next, true);
        } catch (error) {
          preferencesRef.current = previous;
          setPreferences(previous);
          if (previousSchedule && nextSchedule?.active !== previousSchedule.active) {
            try {
              const restored = await setSelfCheckInActive(previousSchedule.active);
              scheduleRef.current = restored;
              setSchedule(restored);
              await saveSelfSchedule(restored);
            } catch {
              scheduleRef.current = previousSchedule;
              setSchedule(previousSchedule);
            }
          }
          await savePreferences(previous);
          await syncNotifications(scheduleRef.current, previous, true);
          Alert.alert(
            'Could not save setting',
            error instanceof Error ? error.message : 'Please check your connection and try again.',
          );
        }
      })();
    },
    [syncNotifications],
  );

  const clearAuthenticatedDevice = useCallback(async () => {
    await stopActiveReminderAlert();
    await syncNotifications(null, defaultPreferences, true);
    clearNativeSafetyLocationConfiguration();
    await clearLocalData();
    setAuthenticated(false);
    setEntitled(false);
    entitlementRef.current = false;
    setDevelopmentPreview(false);
    setSubscriptionVisible(false);
    setFamilyPlanMinimum(3);
    setSubscriptionFamilyMode(false);
    setPendingReminderAction(null);
    setName('');
    setPhone('');
    setContacts([]);
    setFamilyPlan(null);
    setSchedule(null);
    scheduleRef.current = null;
    preferencesRef.current = defaultPreferences;
    setPreferences(defaultPreferences);
    setBackgroundLocationReady(Platform.OS !== 'android');
    notificationSignatureRef.current = '';
    navigateRoot('welcome');
  }, [navigateRoot, syncNotifications]);

  const logout = useCallback(() => {
    Alert.alert('Log out of Din Din?', 'Your reminders on this device will be turned off.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          try {
            await logoutOnServer();
            await clearAuthenticatedDevice();
          } catch (error) {
            Alert.alert(
              'Could not log out',
              error instanceof Error ? error.message : 'Please check your connection and try again.',
            );
          }
        },
      },
    ]);
  }, [clearAuthenticatedDevice]);

  const deleteAccount = useCallback(() => {
    Alert.alert(
      'Permanently delete account?',
      'Your account, contacts, reminder history, saved location, and Din Din data will be deleted. This does not cancel a Google Play or App Store subscription.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true);
            try {
              await deleteAccountOnServer();
              await clearAuthenticatedDevice();
            } catch (error) {
              Alert.alert(
                'Could not delete account',
                error instanceof Error ? error.message : 'Please check your connection and try again.',
              );
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ],
    );
  }, [clearAuthenticatedDevice]);

  const completeRegistration = async (otp: string) => {
    const auth = await verifyOtpRegistration(name, phone, otp);
    await Promise.all([saveSession(), saveProfile(name), saveAuthSession(auth)]);
    setPhone(auth.phone);
    setAuthenticated(true);
    try {
      const entitlement = await fetchBillingEntitlement();
      if (entitlement.active) {
        await saveSubscription();
        setEntitled(true);
        entitlementRef.current = true;
      }
    } catch {
      // Registration and contact setup remain available while billing is unavailable.
    }
    navigateRoot((await readSafetySetup()) ? 'home' : 'safety-setup');
  };

  const activateSubscription = async () => {
    await Promise.all([saveSubscription(), clearSubscriptionPreview()]);
    setEntitled(true);
    entitlementRef.current = true;
    setDevelopmentPreview(false);
    setSubscriptionVisible(false);
    setFamilyPlanMinimum(3);
    setSubscriptionFamilyMode(false);
    Promise.all([fetchBillingEntitlement(), fetchFamilyPlan()])
      .then(([entitlement, latestFamilyPlan]) => {
        setEntitled(entitlement.active);
        entitlementRef.current = entitlement.active;
        setFamilyPlan(latestFamilyPlan);
      })
      .catch(() => undefined);
    if (pendingReminderAction) {
      setReminderEditorRequest(previous => ({
        key: (previous?.key || 0) + 1,
        reminderId: pendingReminderAction.reminderId,
      }));
      setPendingReminderAction(null);
    }
  };

  const activateDevelopmentPreview = async () => {
    await Promise.all([saveSubscription(), saveSubscriptionPreview()]);
    setEntitled(true);
    entitlementRef.current = true;
    setDevelopmentPreview(true);
    setSubscriptionVisible(false);
    setFamilyPlanMinimum(3);
    setSubscriptionFamilyMode(false);
    if (pendingReminderAction) {
      setReminderEditorRequest(previous => ({
        key: (previous?.key || 0) + 1,
        reminderId: pendingReminderAction.reminderId,
      }));
      setPendingReminderAction(null);
    }
  };

  const requestReminderEditor = async (reminderId?: string) => {
    let active = entitlementRef.current;
    if (!developmentPreview) {
      try {
        const remote = await fetchBillingEntitlement();
        active = remote.active;
        setEntitled(active);
        entitlementRef.current = active;
        if (active) await saveSubscription();
        else await clearSubscription();
      } catch {
        // Use the last verified entitlement when billing is temporarily unavailable.
      }
    }
    if (!active) {
      setPendingReminderAction({reminderId});
      setSubscriptionFamilyMode(false);
      setSubscriptionVisible(true);
      return;
    }
    setReminderEditorRequest(previous => ({key: (previous?.key || 0) + 1, reminderId}));
  };

  const clearHandledReminderEditorRequest = useCallback((key: number) => {
    setReminderEditorRequest(current => current?.key === key ? null : current);
  }, []);

  const openReminderList = () => {
    setReminderEditorRequest(null);
    navigate('schedule');
  };

  const openReminderEditorFromHome = (reminderId?: string) => {
    setReminderEditorRequest(null);
    navigate('schedule');
    requestReminderEditor(reminderId).catch(error => {
      Alert.alert(
        'Could not open reminder',
        error instanceof Error ? error.message : 'Please try again.',
      );
    });
  };

  const completeSafetySetup = async (enable: boolean) => {
    if (!enable) {
      await saveSafetySetup();
      navigateRoot('home');
      return;
    }
    setEnablingLocation(true);
    try {
      const permission = await requestSafetyLocationPermission();
      if (!permission.foreground) {
        Alert.alert(
          'Location permission is required',
          'Allow precise location so Din Din can share your safety location after a missed check-in.',
        );
        return;
      }
      if (!permission.background) {
        setBackgroundLocationReady(false);
        Alert.alert(
          'Allow location all the time',
          'Open Din Din permissions and choose “Allow all the time”, then return and tap Enable again.',
          [
            {text: 'Later', style: 'cancel'},
            {text: 'Open settings', onPress: openSafetyLocationSettings},
          ],
        );
        return;
      }
      const nextPreferences = {...preferencesRef.current, safetyLocation: true};
      setBackgroundLocationReady(true);
      preferencesRef.current = nextPreferences;
      setPreferences(nextPreferences);
      await Promise.all([
        savePreferences(nextPreferences),
        savePreferencesOnServer(nextPreferences),
        captureAndReportSafetyLocation(false),
        saveSafetySetup(),
      ]);
      navigateRoot('home');
    } finally {
      setEnablingLocation(false);
    }
  };

  const addContact = async (draft: DraftContact) => {
    setSavingContact(true);
    try {
      const created = await createContact(draft);
      const next = [...contacts, created];
      setContacts(next);
      await saveContacts(next);
      navigateRoot('circle');
    } catch (error) {
      Alert.alert(
        'Could not add contact',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSavingContact(false);
    }
  };

  const togglePrimary = async (contact: EmergencyContact, primary: boolean) => {
    const previous = contacts;
    const optimistic = contacts.map(item =>
      item.id === contact.id ? {...item, primary} : item,
    );
    setContacts(optimistic);
    try {
      const updated = await updateContact(contact.id, {primary});
      const next = optimistic.map(item => (item.id === updated.id ? updated : item));
      setContacts(next);
      await saveContacts(next);
    } catch (error) {
      setContacts(previous);
      Alert.alert(
        'Could not update contact',
        error instanceof Error ? error.message : 'Please try again.',
      );
    }
  };

  const removeContact = (contact: EmergencyContact) => {
    Alert.alert('Remove contact?', `${contact.name} will no longer receive alerts.`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteContact(contact.id);
            const next = contacts.filter(item => item.id !== contact.id);
            setContacts(next);
            await saveContacts(next);
          } catch (error) {
            Alert.alert(
              'Could not remove contact',
              error instanceof Error ? error.message : 'Please try again.',
            );
          }
        },
      },
    ]);
  };

  const openFamilyMembers = async () => {
    navigate('family-members');
    setFamilyLoading(true);
    try {
      setFamilyPlan(await fetchFamilyPlan());
    } catch (error) {
      Alert.alert(
        'Could not load family members',
        error instanceof Error ? error.message : 'Please check your connection and try again.',
      );
    } finally {
      setFamilyLoading(false);
    }
  };

  const openFamilyPlans = (minimumCapacity = 3) => {
    setFamilyPlanMinimum(Math.max(3, Math.min(8, minimumCapacity)));
    setSubscriptionFamilyMode(true);
    setSubscriptionVisible(true);
  };

  const addFamilyMember = async (memberPhone: string) => {
    setAddingFamilyMember(true);
    try {
      setFamilyPlan(await addFamilyPlanMember(memberPhone));
    } finally {
      setAddingFamilyMember(false);
    }
  };

  const saveSchedule = async (values: ReminderScheduleValues) => {
    if (!entitlementRef.current) {
      setPendingReminderAction({});
      setSubscriptionFamilyMode(false);
      setSubscriptionVisible(true);
      return false;
    }
    if (!contacts.some(contact => contact.primary)) {
      Alert.alert('Add a primary contact', 'Choose at least one person to receive missed check-in alerts.');
      return false;
    }
    const backgroundLocation = await hasAndroidBackgroundLocationPermission();
    if (!preferencesRef.current.safetyLocation || !backgroundLocation) {
      Alert.alert(
        'Enable safety location',
        'Din Din needs “Always” location access before it can activate a safety reminder.',
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Set up', onPress: () => navigate('safety-setup')},
        ],
      );
      return false;
    }
    setSavingSchedule(true);
    try {
      let exactAlarmsEnabled = true;
      if (preferencesRef.current.notifications) {
        const permission = await requestReminderPermission();
        exactAlarmsEnabled = permission.exactAlarmsEnabled;
        if (!permission.notificationsEnabled) {
          Alert.alert(
            'Notifications are required',
            'Enable notifications for Din Din so your check-in reminder can reach you.',
          );
          return false;
        }
      }
      let saved = await saveSelfCheckInSchedule(values);
      if (!preferencesRef.current.notifications) {
        saved = await setSelfCheckInActive(false);
      }
      await persistSchedule(saved);
      navigateRoot('home');
      if (!exactAlarmsEnabled) {
        Alert.alert(
          'Allow exact alarms',
          'For check-ins to ring at the exact chosen time, allow alarms and reminders for Din Din.',
          [
            {text: 'Later', style: 'cancel'},
            {text: 'Open settings', onPress: openExactAlarmSettings},
          ],
        );
      }
      return true;
    } catch (error) {
      Alert.alert(
        'Could not save reminder',
        error instanceof Error ? error.message : 'Please check your connection and try again.',
      );
      return false;
    } finally {
      setSavingSchedule(false);
    }
  };

  const deleteReminder = async (reminderId: string) => {
    const current = scheduleRef.current;
    if (!current) return false;
    const remaining = current.reminders.filter(item => item.id !== reminderId);
    if (remaining.length === current.reminders.length) return false;
    setSavingSchedule(true);
    try {
      if (!remaining.length) {
        await deleteSelfCheckInSchedule();
        await persistSchedule(null);
      } else {
        let saved = await saveSelfCheckInSchedule({reminders: remaining});
        if (!preferencesRef.current.notifications) {
          saved = await setSelfCheckInActive(false);
        }
        await persistSchedule(saved);
      }
      return true;
    } catch (error) {
      Alert.alert(
        'Could not delete reminder',
        error instanceof Error ? error.message : 'Please check your connection and try again.',
      );
      return false;
    } finally {
      setSavingSchedule(false);
    }
  };

  const confirmOkay = async () => {
    if (!schedule || acknowledging) return;
    setAcknowledging(true);
    try {
      const updated = await respondToReminder(
        schedule.id,
        new Date(schedule.nextRunAt).getTime(),
        'okay',
      );
      if (updated) await persistSchedule(updated);
      else await synchronize();
    } catch (error) {
      Alert.alert(
        'Could not confirm check-in',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setAcknowledging(false);
    }
  };

  const confirmNotOkay = async () => {
    if (!schedule || escalating) return;
    setEscalating(true);
    try {
      const updated = await respondToReminder(
        schedule.id,
        new Date(schedule.nextRunAt).getTime(),
        'not-okay',
      );
      if (updated) await persistSchedule(updated);
      else await synchronize();
      Alert.alert('Your circle has been alerted', 'Din Din sent your safety alert immediately.');
    } catch (error) {
      Alert.alert(
        'Could not alert your circle',
        error instanceof Error ? error.message : 'Please call a trusted contact or emergency service now.',
      );
    } finally {
      setEscalating(false);
    }
  };

  if (!ready) return <Splash />;

  const effectivePreferences = {
    ...preferences,
    safetyLocation: preferences.safetyLocation && backgroundLocationReady,
  };

  return (
    <>
      <StatusBar barStyle="dark-content" />
      {screen === 'welcome' && <WelcomeScreen onStart={() => navigate('register')} />}
      {screen === 'register' && (
        <RegisterScreen
          onBack={goBack}
          onContinue={async (mobile, profileName) => {
            await requestRegistrationOtp(mobile);
            setPhone(mobile);
            setName(profileName);
            navigate('otp');
          }}
        />
      )}
      {screen === 'otp' && (
        <OtpScreen
          phone={phone}
          onBack={goBack}
          onResend={() => requestRegistrationOtp(phone)}
          onVerified={completeRegistration}
        />
      )}
      {screen === 'subscription' && (
        <SubscriptionScreen
          onActivated={activateSubscription}
          onDevelopmentPreview={activateDevelopmentPreview}
        />
      )}
      {screen === 'safety-setup' && (
        <SafetySetupScreen
          enabling={enablingLocation}
          onEnable={() => completeSafetySetup(true)}
          onSkip={() => completeSafetySetup(false)}
        />
      )}
      {screen === 'home' && (
        <HomeScreen
          name={name || 'Friend'}
          schedule={entitled ? schedule : schedule ? {...schedule, active: false} : null}
          reminderEnabled={entitled && effectivePreferences.notifications}
          acknowledging={acknowledging}
          escalating={escalating}
          onManageReminders={openReminderList}
          onAddReminder={() => openReminderEditorFromHome()}
          onEditReminder={openReminderEditorFromHome}
          onAcknowledge={confirmOkay}
          onNotOkay={confirmNotOkay}
          onTab={handleTab}
        />
      )}
      {screen === 'add-contact' && (
        <AddContactScreen onBack={goBack} onSave={addContact} saving={savingContact} />
      )}
      {screen === 'schedule' && (
        <ScheduleScreen
          schedule={schedule}
          primaryContactCount={contacts.filter(contact => contact.primary).length}
          saving={savingSchedule}
          editorRequest={reminderEditorRequest}
          safetyLocationEnabled={effectivePreferences.safetyLocation}
          onBack={goBack}
          onAddContact={() => navigate('add-contact')}
          onEnableLocation={() => navigate('safety-setup')}
          onEditorRequestHandled={clearHandledReminderEditorRequest}
          onRequestEditor={requestReminderEditor}
          onDelete={deleteReminder}
          onSave={saveSchedule}
        />
      )}
      {screen === 'circle' && (
        <CircleScreen
          contacts={contacts}
          onAdd={() => navigate('add-contact')}
          onTogglePrimary={togglePrimary}
          onRemove={removeContact}
          onTab={handleTab}
        />
      )}
      {screen === 'settings' && (
        <SettingsScreen
          preferences={effectivePreferences}
          onPreferencesChange={updatePreferences}
          onSafetyLocation={() => navigate('safety-setup')}
          onPrivacy={() => navigate('privacy-settings')}
          onManageBilling={() => {
            const sku = familyPlan?.role === 'owner' ? 'dindin_family' : 'dindin_premium';
            const url = Platform.OS === 'android'
              ? `https://play.google.com/store/account/subscriptions?sku=${sku}&package=info.dindin.app`
              : 'https://apps.apple.com/account/subscriptions';
            Linking.openURL(url).catch(() => Alert.alert('Could not open subscription settings'));
          }}
          onFamily={openFamilyMembers}
          onLogout={logout}
          onDeleteAccount={deleteAccount}
          deletingAccount={deletingAccount}
          onTab={handleTab}
        />
      )}
      {screen === 'family-members' && (
        <FamilyMembersScreen
          family={familyPlan}
          ownerPhone={phone}
          loading={familyLoading}
          adding={addingFamilyMember}
          onBack={goBack}
          onAdd={addFamilyMember}
          onChoosePlan={openFamilyPlans}
        />
      )}
      {screen === 'privacy-settings' && <PrivacySettingsScreen onBack={goBack} />}
      <Modal visible={subscriptionVisible} animationType="slide" onRequestClose={() => {
        setSubscriptionVisible(false);
        setFamilyPlanMinimum(3);
        setSubscriptionFamilyMode(false);
        setPendingReminderAction(null);
      }}>
        <SubscriptionScreen
          onActivated={activateSubscription}
          onDevelopmentPreview={activateDevelopmentPreview}
          minimumFamilyCapacity={familyPlanMinimum}
          initialPlanGroup={subscriptionFamilyMode ? 'family' : 'individual'}
          onClose={() => {
            setSubscriptionVisible(false);
            setFamilyPlanMinimum(3);
            setSubscriptionFamilyMode(false);
            setPendingReminderAction(null);
          }}
        />
      </Modal>
    </>
  );
}

function Splash() {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.78)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {toValue: 1, duration: 400, useNativeDriver: true}),
      Animated.spring(scale, {toValue: 1, damping: 12, stiffness: 130, useNativeDriver: true}),
    ]).start();
  }, [opacity, scale]);
  return (
    <View style={styles.splash}>
      <Animated.View style={{opacity, transform: [{scale}]}}>
        <FloatingMascot size={205} />
        <Text style={styles.splashBrand}>Din Din</Text>
        <Text style={styles.splashTagline}>A gentle ping. Complete peace of mind.</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashBrand: {
    marginTop: -10,
    fontSize: 42,
    lineHeight: 48,
    color: colors.ink,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -1.5,
  },
  splashTagline: {
    marginTop: 7,
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textAlign: 'center',
  },
});
