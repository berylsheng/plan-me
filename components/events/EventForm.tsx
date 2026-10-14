import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { FormField } from '@/components/auth/FormField';
import { ShareToggle } from '@/components/events/ShareToggle';
import { type EventForm as Form, type FormErrors, withDate } from '@/lib/events/editForm';
import { latestUntil } from '@/lib/events/repeat';
import type { Member } from '@/lib/family/types';

import { DateField } from './form/DateField';
import { PeoplePicker } from './form/PeoplePicker';
import { RepeatPicker } from './form/RepeatPicker';
import { TimeField } from './form/TimeField';

type Props = {
  form: Form;
  errors: FormErrors;
  onChange: (form: Form) => void;
  members: Member[];
  memberById: ReadonlyMap<string, Member>;
  myId: string | null;
  showShare: boolean;
  shareLocked: boolean;
  repeatLockedMessage: string | null;
};

/** Every field of an event. Controlled: the screen owns the form and decides what saving does. */
export function EventForm({ form, errors, onChange, members, memberById, myId, showShare, shareLocked, repeatLockedMessage }: Props) {
  const set = (patch: Partial<Form>) => onChange({ ...form, ...patch });
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <FormField label="Name" kind="plain" value={form.name} onChangeText={name => set({ name })} error={errors.name} />
      <DateField label="Date" value={form.dateKey} onChange={dateKey => onChange(withDate(form, dateKey))} />
      <TimeField label="Start time" value={form.startTime} onChange={startTime => set({ startTime })} />
      <TimeField label="End time" value={form.endTime} onChange={endTime => set({ endTime })} error={errors.endTime} />
      <RepeatPicker
        preset={form.repeat}
        every={form.customEvery}
        unit={form.customUnit}
        error={errors.customEvery}
        lockedMessage={repeatLockedMessage}
        onChange={next => set({ repeat: next.preset, customEvery: next.every, customUnit: next.unit })}
      />
      {form.repeat !== 'none' ? (
        <DateField
          label="Ends on"
          value={form.until}
          minDate={form.dateKey}
          maxDate={latestUntil(form.dateKey)}
          onChange={until => set({ until })}
          error={errors.until}
          disabled={repeatLockedMessage !== null}
        />
      ) : null}
      <PeoplePicker
        members={members}
        memberById={memberById}
        myId={myId}
        memberIds={form.memberIds}
        legacyTags={form.legacyTags}
        onChange={people => set(people)}
      />
      {showShare ? <ShareToggle shared={form.shared} onChange={shared => set({ shared })} disabled={shareLocked} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
});
