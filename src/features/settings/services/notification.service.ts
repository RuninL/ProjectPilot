import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

export type NotificationPermission = 'granted' | 'denied';

/** Native Tauri notification boundary; callers never fall back to browser notifications. */
export async function getNotificationPermission(): Promise<NotificationPermission> {
  return (await isPermissionGranted()) ? 'granted' : 'denied';
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return (await requestPermission()) === 'granted' ? 'granted' : 'denied';
}

export async function sendTestNotification(): Promise<void> {
  await sendNativeNotification('ProjectPilot', 'Native Windows notifications are enabled.');
}

/** Sends a single native toast after the official plugin permission boundary. */
export async function sendNativeNotification(title: string, body: string): Promise<void> {
  if ((await getNotificationPermission()) !== 'granted') {
    throw new Error('Windows notification permission is not granted.');
  }
  sendNotification({
    title,
    body,
  });
}
