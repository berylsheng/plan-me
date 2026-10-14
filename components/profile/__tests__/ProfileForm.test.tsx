import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { FamilyContext } from '@/context/FamilyProvider';
import { pickAvatar } from '@/lib/profile/pickAvatar';
import { FAKE_ME, fakeFamilyValue } from '@/test-utils/fakeFamily';

import { ProfileForm } from '../ProfileForm';

jest.mock('@/lib/profile/pickAvatar', () => ({ pickAvatar: jest.fn() }));
const pick = pickAvatar as jest.MockedFunction<typeof pickAvatar>;

function renderForm(family = fakeFamilyValue(), me = FAKE_ME) {
  render(
    <FamilyContext.Provider value={family}>
      <ProfileForm me={me} />
    </FamilyContext.Provider>,
  );
  return family;
}

describe('ProfileForm', () => {
  it('saves your name and tag', async () => {
    const family = renderForm();
    fireEvent.changeText(screen.getByLabelText('Your tag'), 'ali');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(family.updateProfile).toHaveBeenCalledWith({ displayName: 'Alice', tag: 'ali' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('uploads a chosen photo', async () => {
    pick.mockResolvedValueOnce({ ok: true, base64: 'SMALL' });
    const family = renderForm();
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await waitFor(() => expect(family.setAvatar).toHaveBeenCalledWith('SMALL'));
  });

  it('says nothing when you cancel', async () => {
    pick.mockResolvedValueOnce({ ok: false, reason: 'canceled' });
    const family = renderForm();
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await waitFor(() => expect(pick).toHaveBeenCalled());
    expect(family.setAvatar).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers to remove a photo you have', async () => {
    const family = renderForm(fakeFamilyValue(), { ...FAKE_ME, avatarPath: 'user-1/a.jpg' });
    fireEvent.press(screen.getByRole('button', { name: 'Remove photo' }));
    await waitFor(() => expect(family.removeAvatar).toHaveBeenCalled());
  });

  it("doesn't offer to remove a photo you don't have", () => {
    renderForm();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
  });
});
