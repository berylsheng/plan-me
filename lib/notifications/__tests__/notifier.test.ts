import * as Notifications from 'expo-notifications';

import { expoNotifier, SUMMARY_KIND } from '../notifier';

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;

describe('expoNotifier', () => {
  it('reads permission as granted, denied or not asked yet', async () => {
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
    expect(await expoNotifier.permission()).toBe('granted');
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false } as never);
    expect(await expoNotifier.permission()).toBe('denied');
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true } as never);
    expect(await expoNotifier.permission()).toBe('undetermined');
  });

  it('cancels only morning summaries', async () => {
    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      { identifier: 'a', content: { data: { kind: SUMMARY_KIND } } },
      { identifier: 'b', content: { data: { kind: 'something-else' } } },
      { identifier: 'c', content: { data: null } },
    ] as never);
    await expoNotifier.cancelSummaries();
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('a');
  });

  it('schedules each summary at its date, marked as a summary', async () => {
    const fireAt = new Date(2026, 9, 15, 7, 0);
    await expoNotifier.scheduleSummaries([{ dateKey: '2026-10-15', fireAt, title: 'Today: 1 event', body: '7:30 am Swim' }]);
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'Today: 1 event', body: '7:30 am Swim', data: { kind: SUMMARY_KIND, dateKey: '2026-10-15' } },
      trigger: { type: 'date', date: fireAt },
    });
  });

  it('reports taps on summaries only, including the one that opened the app', async () => {
    const response = (data: unknown) => ({ notification: { request: { content: { data } } } });
    mocked.getLastNotificationResponseAsync.mockResolvedValueOnce(response({ kind: SUMMARY_KIND, dateKey: '2026-10-15' }) as never);
    const listener = jest.fn();
    expoNotifier.onSummaryTapped(listener);
    await new Promise(resolve => setImmediate(resolve));
    expect(listener).toHaveBeenCalledWith('2026-10-15');
    expect(mocked.clearLastNotificationResponseAsync).toHaveBeenCalled();

    const onTap = mocked.addNotificationResponseReceivedListener.mock.calls[0][0];
    onTap(response({ kind: 'something-else', dateKey: '2026-10-16' }) as never);
    onTap(response({ kind: SUMMARY_KIND, dateKey: '2026-10-17' }) as never);
    expect(listener.mock.calls).toEqual([['2026-10-15'], ['2026-10-17']]);
  });

  it('shows summaries as a banner while the app is open', () => {
    expoNotifier.showWhileOpen();
    expect(mocked.setNotificationHandler).toHaveBeenCalledTimes(1);
  });
});
