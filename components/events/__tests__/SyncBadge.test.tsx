import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { RefusedNoticeView, syncMessage } from '../SyncBadge';

describe('syncMessage', () => {
  it.each([
    [{ state: 'idle', pending: 0, lastSyncedAt: 't' }, null],
    [{ state: 'syncing', pending: 1, lastSyncedAt: 't' }, 'Syncing 1 change…'],
    [{ state: 'idle', pending: 3, lastSyncedAt: 't' }, 'Syncing 3 changes…'],
    [{ state: 'offline', pending: 0, lastSyncedAt: 't' }, "Offline. Showing what's saved on this phone."],
    [{ state: 'offline', pending: 2, lastSyncedAt: 't' }, "Offline. 2 changes will sync when you're back online."],
    [{ state: 'needs-sign-in', pending: 1, lastSyncedAt: 't' }, "Offline. 1 change will sync when you're back online."],
    [{ state: 'loading', pending: 0, lastSyncedAt: null }, null],
  ] as const)('%p → %p', (status, expected) => {
    expect(syncMessage(status)).toBe(expected);
  });
});

describe('RefusedNoticeView', () => {
  it('says a change was undone until you tap OK', () => {
    const { rerender } = render(<RefusedNoticeView refused={0} />);
    expect(screen.queryByText(/couldn't be saved/)).toBeNull();
    rerender(<RefusedNoticeView refused={1} />);
    expect(screen.getByText("A change couldn't be saved, so the event shows its last saved version.")).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText(/couldn't be saved/)).toBeNull();
    rerender(<RefusedNoticeView refused={2} />);
    expect(screen.getByText(/couldn't be saved/)).toBeTruthy();
  });

  it('starts over for a new engine', () => {
    const { rerender } = render(<RefusedNoticeView refused={3} />);
    fireEvent.press(screen.getByRole('button', { name: 'OK' }));
    rerender(<RefusedNoticeView refused={0} />);
    rerender(<RefusedNoticeView refused={1} />);
    expect(screen.getByText(/couldn't be saved/)).toBeTruthy();
  });
});
