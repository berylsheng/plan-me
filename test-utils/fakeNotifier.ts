import type { Notifier, Permission } from '@/lib/notifications/notifier';
import type { PlannedSummary } from '@/lib/notifications/schedule';

/** A notifier that records calls, in order in `log`. `setRequestResult` decides what asking for permission returns; `tap` acts as if a summary was tapped. */
export function fakeNotifier(permission: Permission = 'granted') {
  let current = permission;
  let requestResult: Permission = permission === 'undetermined' ? 'granted' : permission;
  const calls = { handler: 0, requested: 0, cancelled: 0, scheduled: [] as PlannedSummary[][] };
  const log: string[] = [];
  let tapped: ((dateKey: string) => void) | null = null;
  const notifier: Notifier = {
    showWhileOpen: () => {
      calls.handler++;
    },
    permission: async () => current,
    requestPermission: async () => {
      calls.requested++;
      current = requestResult;
      return requestResult;
    },
    cancelSummaries: async () => {
      calls.cancelled++;
      log.push('cancel');
    },
    scheduleSummaries: async planned => {
      calls.scheduled.push(planned);
      log.push(`schedule:${planned.length}`);
    },
    onSummaryTapped: listener => {
      tapped = listener;
      return () => {
        tapped = null;
      };
    },
  };
  return {
    notifier,
    calls,
    log,
    tap: (dateKey: string) => tapped?.(dateKey),
    setPermission: (p: Permission) => {
      current = p;
    },
    setRequestResult: (p: Permission) => {
      requestResult = p;
    },
  };
}
