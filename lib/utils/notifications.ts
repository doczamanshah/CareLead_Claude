import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Task } from '@/lib/types/tasks';

// Configure how notifications appear when the app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request notification permissions. Call once on first app launch.
 * Returns true if permissions were granted.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Schedule a local push notification for a task reminder.
 * Uses the task's reminder_at date. If no reminder_at, does nothing.
 * Returns the notification identifier, or null if not scheduled.
 */
export async function scheduleTaskReminder(task: Task): Promise<string | null> {
  if (!task.reminder_at) return null;

  const triggerDate = new Date(task.reminder_at);
  if (triggerDate <= new Date()) return null; // Don't schedule past reminders

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Task Reminder',
      body: task.title,
      data: { taskId: task.id, type: 'task_reminder' },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
    },
  });

  return id;
}

/**
 * Cancel a previously scheduled notification by its identifier.
 */
export async function cancelTaskReminder(notificationId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}

/**
 * Cancel all scheduled notifications (useful on logout).
 */
export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Get the notification response listener. Use this in the root layout
 * to handle taps on notifications and navigate to the task detail screen.
 */
export function addNotificationResponseListener(
  handler: (taskId: string) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (data?.type === 'task_reminder' && data?.taskId) {
      handler(data.taskId as string);
    }
  });
}
