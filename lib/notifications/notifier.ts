import * as Notifications from 'expo-notifications';

import type { PlannedSummary } from './schedule';

export type Permission = 'granted' | 'denied' | 'undetermined';

/** Everything the app does with notifications, so tests can swap in a fake. */
export interface Notifier {
  showWhileOpen(): void;
  permission(): Promise<Permission>;
  requestPermission(): Promise<Permission>;
  cancelSummaries(): Promise<void>;
  scheduleSummaries(planned: PlannedSummary[]): Promise<void>;
  /** Calls back with the summary's date when one is tapped (including the tap that opened the app). Returns an unsubscribe. */
  onSummaryTapped(listener: (dateKey: string) => void): () => void;
}

/** Marks the app's morning summaries, so only they are ever cancelled. */
export const SUMMARY_KIND = 'morning-summary';

const toPermission = (status: Notifications.NotificationPermissionsStatus): Permission =>
  status.granted ? 'granted' : status.canAskAgain ? 'undetermined' : 'denied';

export const expoNotifier: Notifier = {
  showWhileOpen() {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
  },
  async permission() {
    return toPermission(await Notifications.getPermissionsAsync());
  },
  async requestPermission() {
    return toPermission(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }));
  },
  async cancelSummaries() {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ours = scheduled.filter(n => (n.content.data as { kind?: unknown } | null)?.kind === SUMMARY_KIND);
    await Promise.all(ours.map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  },
  async scheduleSummaries(planned) {
    for (const p of planned) {
      await Notifications.scheduleNotificationAsync({
        content: { title: p.title, body: p.body, data: { kind: SUMMARY_KIND, dateKey: p.dateKey } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.fireAt },
      });
    }
  },
  onSummaryTapped(listener) {
    const handle = (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data as { kind?: unknown; dateKey?: unknown } | null | undefined;
      if (data?.kind === SUMMARY_KIND && typeof data.dateKey === 'string') listener(data.dateKey);
    };
    // A tap that launched the app arrives before any listener exists; read it once, then forget it.
    void Notifications.getLastNotificationResponseAsync()
      .then(response => {
        handle(response);
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    return () => subscription.remove();
  },
};
