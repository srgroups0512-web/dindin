import {
  getMessaging,
  getToken,
  onMessage,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
  type RemoteMessage,
} from '@react-native-firebase/messaging';
import {Platform} from 'react-native';
import {registerPushTokenOnServer, unregisterPushTokenOnServer} from './checkIns';
import {displayRemoteReminder} from './reminders';

async function currentPushToken() {
  const messaging = getMessaging();
  if (Platform.OS === 'ios') await registerDeviceForRemoteMessages(messaging);
  return getToken(messaging);
}

async function handleRemoteMessage(message: RemoteMessage) {
  await displayRemoteReminder(message.data);
}

export async function startPushNotifications(): Promise<() => void> {
  const messaging = getMessaging();
  const token = await currentPushToken();
  await registerPushTokenOnServer(token);
  const stopTokenRefresh = onTokenRefresh(messaging, nextToken => {
    registerPushTokenOnServer(nextToken).catch(error => {
      console.warn('Could not refresh Din Din push registration', error);
    });
  });
  const stopForegroundMessages = onMessage(messaging, handleRemoteMessage);
  return () => {
    stopTokenRefresh();
    stopForegroundMessages();
  };
}

export async function unregisterCurrentPushToken(): Promise<void> {
  const token = await currentPushToken();
  await unregisterPushTokenOnServer(token);
}
