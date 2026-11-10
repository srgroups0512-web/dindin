/**
 * @format
 */

import { AppRegistry } from 'react-native';
import notifee from '@notifee/react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';
import { displayRemoteReminder, handleReminderBackgroundEvent } from './src/services/reminders';

notifee.onBackgroundEvent(handleReminderBackgroundEvent);
setBackgroundMessageHandler(getMessaging(), async message => {
  await displayRemoteReminder(message.data);
});

AppRegistry.registerComponent(appName, () => App);
