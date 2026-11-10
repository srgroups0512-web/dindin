import Geolocation from '@react-native-community/geolocation';
import {
  Linking,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import type {SafetyLocation} from '../models';
import {reportSafetyLocation} from './checkIns';
import {readSafetyLocation, saveSafetyLocation} from './storage';

Geolocation.setRNConfiguration({
  skipPermissionRequests: true,
  authorizationLevel: 'always',
  enableBackgroundLocationUpdates: true,
  locationProvider: 'playServices',
});

export type SafetyLocationPermission = {
  foreground: boolean;
  background: boolean;
  needsSettings: boolean;
};

export async function requestSafetyLocationPermission(): Promise<SafetyLocationPermission> {
  if (Platform.OS === 'ios') {
    const granted = await new Promise<boolean>(resolve => {
      Geolocation.requestAuthorization(
        () => resolve(true),
        () => resolve(false),
      );
    });
    return {foreground: granted, background: granted, needsSettings: !granted};
  }

  const foregroundResult = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  const foreground =
    foregroundResult[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
    PermissionsAndroid.RESULTS.GRANTED;
  if (!foreground) return {foreground: false, background: false, needsSettings: false};

  const apiLevel = Number(Platform.Version);
  if (apiLevel < 29) return {foreground: true, background: true, needsSettings: false};
  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION;
  if (await PermissionsAndroid.check(permission)) {
    return {foreground: true, background: true, needsSettings: false};
  }
  if (apiLevel === 29) {
    const result = await PermissionsAndroid.request(permission);
    const background = result === PermissionsAndroid.RESULTS.GRANTED;
    return {foreground: true, background, needsSettings: !background};
  }
  return {foreground: true, background: false, needsSettings: true};
}

export async function openSafetyLocationSettings() {
  await Linking.openSettings();
}

export async function hasAndroidBackgroundLocationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 29) return true;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
}

export async function captureFreshSafetyLocation(): Promise<SafetyLocation> {
  return new Promise<SafetyLocation>((resolve, reject) => {
    Geolocation.getCurrentPosition(
      position => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        });
      },
      error => reject(new Error(error.message || 'Location is unavailable')),
      {enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000},
    );
  });
}

export async function captureAndReportSafetyLocation(
  allowCached = true,
): Promise<SafetyLocation | null> {
  let location: SafetyLocation | null = null;
  try {
    location = await captureFreshSafetyLocation();
    await saveSafetyLocation(location);
  } catch {
    if (allowCached) location = await readSafetyLocation();
  }
  if (!location) return null;
  try {
    await reportSafetyLocation(location);
  } catch {
    // A later foreground sync can retry without blocking the local safety action.
  }
  return location;
}
