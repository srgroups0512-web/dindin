/* global jest */

jest.mock('react-native-iap', () => ({
  useIAP: () => ({
    connected: false,
    products: [],
    subscriptions: [],
    availablePurchases: [],
    fetchProducts: jest.fn(() => Promise.resolve()),
    requestPurchase: jest.fn(() => Promise.resolve()),
    finishTransaction: jest.fn(() => Promise.resolve()),
    restorePurchases: jest.fn(() => Promise.resolve()),
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    getMany: jest.fn(() => Promise.resolve({})),
    setMany: jest.fn(() => Promise.resolve()),
    removeMany: jest.fn(() => Promise.resolve()),
    getAllKeys: jest.fn(() => Promise.resolve([])),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  AndroidCategory: {ALARM: 'alarm'},
  AndroidImportance: {HIGH: 4},
  AndroidNotificationSetting: {ENABLED: 1, NOT_SUPPORTED: -1},
  AuthorizationStatus: {AUTHORIZED: 1, PROVISIONAL: 2},
  EventType: {DELIVERED: 3, ACTION_PRESS: 2},
  TriggerType: {TIMESTAMP: 0},
  default: {
    createChannel: jest.fn(async channel => channel.id),
    setNotificationCategories: jest.fn(async () => {}),
    requestPermission: jest.fn(async () => ({
      authorizationStatus: 1,
      android: {alarm: 1},
    })),
    getNotificationSettings: jest.fn(async () => ({
      authorizationStatus: 1,
      android: {alarm: 1},
    })),
    getTriggerNotificationIds: jest.fn(async () => []),
    getDisplayedNotifications: jest.fn(async () => []),
    cancelTriggerNotifications: jest.fn(async () => {}),
    cancelTriggerNotification: jest.fn(async () => {}),
    createTriggerNotification: jest.fn(async notification => notification.id),
    displayNotification: jest.fn(async notification => notification.id),
    cancelNotification: jest.fn(async () => {}),
    openAlarmPermissionSettings: jest.fn(async () => {}),
    onForegroundEvent: jest.fn(() => jest.fn()),
    onBackgroundEvent: jest.fn(() => {}),
  },
}));

jest.mock('@react-native-firebase/messaging', () => ({
  __esModule: true,
  getMessaging: jest.fn(() => ({app: {name: '[DEFAULT]'}})),
  getToken: jest.fn(async () => 'test-firebase-device-token-1234567890'),
  onMessage: jest.fn(() => jest.fn()),
  onTokenRefresh: jest.fn(() => jest.fn()),
  registerDeviceForRemoteMessages: jest.fn(async () => undefined),
  setBackgroundMessageHandler: jest.fn(),
}));

jest.mock('@react-native-community/geolocation', () => ({
  __esModule: true,
  default: {
    setRNConfiguration: jest.fn(),
    requestAuthorization: jest.fn(success => success()),
    getCurrentPosition: jest.fn(success => success({
      coords: {latitude: 22.7196, longitude: 75.8577, accuracy: 10},
      timestamp: Date.now(),
    })),
  },
}));
