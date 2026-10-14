import type { KeyValueStorage } from '@/lib/events/store';

export type SummarySettings = { enabled: boolean; time: string /* 'HH:mm' */ };

export const DEFAULT_SUMMARY_SETTINGS: SummarySettings = { enabled: false, time: '07:00' };

const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const key = (userId: string) => `planMe.morningSummary.${userId}`;

/** This account's morning summary setting on this phone; the default when there is none or it's damaged. */
export async function loadSummarySettings(storage: KeyValueStorage, userId: string): Promise<SummarySettings> {
  try {
    const raw = await storage.getItem(key(userId));
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (typeof value === 'object' && value !== null) {
      const { enabled, time } = value as Record<string, unknown>;
      if (typeof enabled === 'boolean' && typeof time === 'string' && HH_MM.test(time)) return { enabled, time };
    }
  } catch {
    // Unreadable: use the default.
  }
  return { ...DEFAULT_SUMMARY_SETTINGS };
}

export async function saveSummarySettings(storage: KeyValueStorage, userId: string, settings: SummarySettings): Promise<void> {
  await storage.setItem(key(userId), JSON.stringify(settings));
}
