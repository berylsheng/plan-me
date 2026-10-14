import { memoryStorage } from '@/test-utils/memoryStorage';

import { DEFAULT_SUMMARY_SETTINGS, loadSummarySettings, saveSummarySettings } from '../settings';

describe('summary settings', () => {
  it('starts off at 7:00 am', async () => {
    expect(await loadSummarySettings(memoryStorage(), 'user-1')).toEqual({ enabled: false, time: '07:00' });
    expect(DEFAULT_SUMMARY_SETTINGS).toEqual({ enabled: false, time: '07:00' });
  });

  it('keeps each account its own setting', async () => {
    const storage = memoryStorage();
    await saveSummarySettings(storage, 'user-1', { enabled: true, time: '06:30' });
    expect(await loadSummarySettings(storage, 'user-1')).toEqual({ enabled: true, time: '06:30' });
    expect(await loadSummarySettings(storage, 'user-2')).toEqual({ enabled: false, time: '07:00' });
    expect(storage.dump()['planMe.morningSummary.user-1']).toBeDefined();
  });

  it('falls back to the default when the stored value is damaged', async () => {
    const storage = memoryStorage({ 'planMe.morningSummary.user-1': '{"enabled":"yes","time":"25:00"}' });
    expect(await loadSummarySettings(storage, 'user-1')).toEqual({ enabled: false, time: '07:00' });
  });
});
