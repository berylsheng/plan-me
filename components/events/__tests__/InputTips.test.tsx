import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { parseEventInput } from '@/lib/parse/parseEventInput';
import { FAKE_BOB, FAKE_ME } from '@/test-utils/fakeFamily';

import { InputTips, placeholderFor, tipExamples } from '../InputTips';

const open = () => fireEvent.press(screen.getByRole('button', { name: 'Tips' }));

describe('InputTips', () => {
  it('shows how to write dates, people and repeats', () => {
    render(<InputTips members={[FAKE_ME, FAKE_BOB]} myId={FAKE_ME.id} />);
    open();
    expect(screen.getByText('tomorrow 9am dentist')).toBeTruthy();
    expect(screen.getByText('weekly for 4 weeks')).toBeTruthy();
    expect(screen.getByText('swim Tue 7am @AL, weekly for 2 months')).toBeTruthy();
    expect(screen.getByText('@AL You · @BE Bob')).toBeTruthy();
  });

  it('says to join a family before tagging people', () => {
    render(<InputTips members={[]} myId={FAKE_ME.id} />);
    open();
    expect(screen.getByText('Join or create a family on the Family tab to tag people.')).toBeTruthy();
    expect(screen.getByText('swim Tue 7am, weekly for 2 months')).toBeTruthy();
  });

  it('closes with Got it', () => {
    render(<InputTips members={[FAKE_ME]} myId={FAKE_ME.id} />);
    open();
    fireEvent.press(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText('tomorrow 9am dentist')).toBeNull();
  });

  it('says Tips next to the ? so it reads as help', () => {
    render(<InputTips members={[FAKE_ME]} myId={FAKE_ME.id} />);
    expect(screen.getByText('Tips')).toBeTruthy();
  });

  it('is shown but off when the input is off', () => {
    render(<InputTips members={[FAKE_ME]} myId={FAKE_ME.id} disabled />);
    expect(screen.getByRole('button', { name: 'Tips' })).toBeDisabled();
  });

  it('puts your tag and a repeat in the placeholder', () => {
    expect(placeholderFor('AL')).toBe('e.g. 6pm swim @AL, weekly for 4 weeks');
    expect(placeholderFor(null)).toBe('e.g. 6pm swim, weekly for 4 weeks');
  });

  it('reads the placeholder as a weekly 6 pm swim for @AL', () => {
    const result = parseEventInput(placeholderFor('AL').replace(/^e\.g\. /, ''), {
      selectedDateKey: '2026-10-14', knownTags: ['AL'], now: new Date(2026, 9, 14, 9),
    });
    expect(result.ok && result.draft).toMatchObject({ name: 'swim', startTime: '18:00', people: ['AL'], repeat: { every: 1, unit: 'week' } });
    expect(result.ok && result.draft.dateKeys).toHaveLength(4);
  });

  it.each(tipExamples('AL'))("reads the example '%s' as an event", example => {
    const result = parseEventInput(example, { selectedDateKey: '2026-10-14', knownTags: ['AL'], now: new Date(2026, 9, 14, 9) });
    expect(result.ok).toBe(true);
  });

  it('reads the combined example as a weekly event for @AL', () => {
    const result = parseEventInput('swim Tue 7am @AL, weekly for 2 months', {
      selectedDateKey: '2026-10-14', knownTags: ['AL'], now: new Date(2026, 9, 14, 9),
    });
    expect(result.ok && result.draft).toMatchObject({ name: 'swim', startTime: '07:00', people: ['AL'], repeat: { every: 1, unit: 'week' } });
  });
});
