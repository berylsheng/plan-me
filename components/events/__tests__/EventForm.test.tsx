import { fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';

import type { EventForm as Form, FormErrors } from '@/lib/events/editForm';
import { FAKE_BOB, FAKE_ME } from '@/test-utils/fakeFamily';

import { EventForm } from '../EventForm';

jest.mock('react-native-calendars', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Calendar: ({ onDayPress }: { onDayPress: (d: { dateString: string }) => void }) =>
    React.createElement(Text, { onPress: () => onDayPress({ dateString: '2026-11-20' }) }, 'Pick 20/11/2026') };
});
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: ({ onChange }: { onChange: (e: { type: string }, d: Date) => void }) =>
    React.createElement(Text, { onPress: () => onChange({ type: 'set' }, new Date(2026, 9, 13, 18, 30)) }, 'Pick 6:30 pm') };
});

const base: Form = {
  name: 'Swim', dateKey: '2026-10-13', startTime: '07:00', endTime: '', repeat: 'none', customEvery: '1',
  customUnit: 'week', until: '', memberIds: [], legacyTags: ['AZ'], shared: false,
};
const members = [FAKE_ME, FAKE_BOB];

function Harness({ initial = base, errors = {}, repeatLockedMessage = null, onForm }: {
  initial?: Form; errors?: FormErrors; repeatLockedMessage?: string | null; onForm?: (f: Form) => void;
}) {
  const [form, setForm] = useState(initial);
  return (
    <EventForm
      form={form}
      errors={errors}
      onChange={next => { setForm(next); onForm?.(next); }}
      members={members}
      memberById={new Map(members.map(m => [m.id, m]))}
      myId={FAKE_ME.id}
      showShare
      shareLocked={false}
      repeatLockedMessage={repeatLockedMessage}
    />
  );
}

describe('EventForm', () => {
  it('shows the event', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Name').props.value).toBe('Swim');
    expect(screen.getByText('13/10/2026')).toBeTruthy();
    expect(screen.getByText('7:00 am')).toBeTruthy();
    expect(screen.getByRole('radio', { name: "Doesn't repeat" })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Ends on' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: '@AZ' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Bob' })).not.toBeChecked();
  });

  it('picks a date and a time', () => {
    const onForm = jest.fn();
    render(<Harness onForm={onForm} />);
    fireEvent.press(screen.getByRole('button', { name: 'Date' }));
    fireEvent.press(screen.getByText('Pick 20/11/2026'));
    expect(screen.getByText('20/11/2026')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'End time' }));
    fireEvent.press(screen.getByText('Pick 6:30 pm'));
    expect(onForm).toHaveBeenLastCalledWith(expect.objectContaining({ dateKey: '2026-11-20', endTime: '18:30' }));
  });

  it('clears a time', () => {
    const onForm = jest.fn();
    render(<Harness onForm={onForm} />);
    fireEvent.press(screen.getByRole('button', { name: 'Clear start time' }));
    expect(onForm).toHaveBeenLastCalledWith(expect.objectContaining({ startTime: '' }));
  });

  it('chooses a custom repeat and an end date', () => {
    const onForm = jest.fn();
    render(<Harness onForm={onForm} />);
    fireEvent.press(screen.getByRole('radio', { name: 'Custom' }));
    fireEvent.changeText(screen.getByLabelText('Repeat every'), '3');
    fireEvent.press(screen.getByRole('radio', { name: 'days' }));
    fireEvent.press(screen.getByRole('button', { name: 'Ends on' }));
    fireEvent.press(screen.getByText('Pick 20/11/2026'));
    expect(onForm).toHaveBeenLastCalledWith(expect.objectContaining({ repeat: 'custom', customEvery: '3', customUnit: 'day', until: '2026-11-20' }));
  });

  it('toggles people and removes a leftover tag', () => {
    const onForm = jest.fn();
    render(<Harness onForm={onForm} />);
    fireEvent.press(screen.getByRole('checkbox', { name: 'Bob' }));
    fireEvent.press(screen.getByRole('checkbox', { name: '@AZ' }));
    expect(onForm).toHaveBeenLastCalledWith(expect.objectContaining({ memberIds: [FAKE_BOB.id], legacyTags: [] }));
  });

  it('shows a former member on the event', () => {
    render(<Harness initial={{ ...base, memberIds: ['someone-who-left'] }} />);
    expect(screen.getByRole('checkbox', { name: 'Former member' })).toBeChecked();
  });

  it('locks how it repeats for someone who did not create it', () => {
    render(<Harness initial={{ ...base, repeat: 'weekly', until: '2026-11-03' }} repeatLockedMessage="Only Bob can change how this repeats." />);
    expect(screen.getByText('Only Bob can change how this repeats.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Daily' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ends on' })).toBeDisabled();
  });

  it('shows errors under their fields', () => {
    render(<Harness errors={{ name: 'Enter a name.', endTime: 'End after the start time.' }} />);
    expect(screen.getByText('Enter a name.')).toBeTruthy();
    expect(screen.getByText('End after the start time.')).toBeTruthy();
  });
});
