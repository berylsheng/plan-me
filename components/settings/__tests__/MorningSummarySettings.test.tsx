import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { MorningSummaryProvider } from '@/context/MorningSummaryProvider';
import { type Permission } from '@/lib/notifications/notifier';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { fakeNotifier } from '@/test-utils/fakeNotifier';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { MorningSummarySettings } from '../MorningSummarySettings';

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: ({ onChange }: { onChange: (e: { type: string }, d: Date) => void }) =>
    React.createElement(Text, { onPress: () => onChange({ type: 'set' }, new Date(2026, 9, 14, 6, 30)) }, 'Pick 6:30 am') };
});

function renderSettings(permission: Permission = 'undetermined', enabled = false) {
  const fake = fakeNotifier(permission);
  const storage = memoryStorage({ 'planMe.morningSummary.user-1': JSON.stringify({ enabled, time: '07:00' }) });
  render(
    <AuthProvider client={fakeAuthClient(fakeSession()).client}>
      <EventsProvider storage={memoryStorage()} createEngine={createFakeEngine}>
        <MorningSummaryProvider notifier={fake.notifier} storage={storage} delayMs={10}>
          <MorningSummarySettings />
        </MorningSummaryProvider>
      </EventsProvider>
    </AuthProvider>,
  );
  return { fake, storage };
}

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});

describe('MorningSummarySettings', () => {
  it('is off at first, without a time', async () => {
    renderSettings();
    const toggle = await screen.findByRole('switch', { name: 'Morning summary' });
    expect(toggle.props.value).toBe(false);
    expect(screen.getByText("Show today's events each morning")).toBeTruthy();
    expect(screen.queryByText('Time')).toBeNull();
  });

  it('asks iOS when turned on, then shows the time', async () => {
    const { fake } = renderSettings();
    const toggle = await screen.findByRole('switch', { name: 'Morning summary' });
    await act(async () => {
      fireEvent(toggle, 'valueChange', true);
    });
    expect(fake.calls.requested).toBe(1);
    expect(await screen.findByText('7:00 am')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear time' })).toBeNull();
  });

  it('stays off and explains when iOS says no', async () => {
    const { fake } = renderSettings();
    fake.setRequestResult('denied');
    const toggle = await screen.findByRole('switch', { name: 'Morning summary' });
    await act(async () => {
      fireEvent(toggle, 'valueChange', true);
    });
    expect(await screen.findByText('Notifications are off for Plan-Me. Turn them on in iOS Settings.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Morning summary' }).props.value).toBe(false);
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(open).toHaveBeenCalled();
  });

  it('saves a new time', async () => {
    const { storage } = renderSettings('granted', true);
    fireEvent.press(await screen.findByRole('button', { name: 'Time' }));
    await act(async () => {
      fireEvent.press(screen.getByText('Pick 6:30 am'));
    });
    await waitFor(() => expect(JSON.parse(storage.dump()['planMe.morningSummary.user-1'])).toEqual({ enabled: true, time: '06:30' }));
  });
});
