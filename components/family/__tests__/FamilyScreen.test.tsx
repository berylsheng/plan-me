import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Alert, Text } from 'react-native';

import { FamilyContext, type FamilyValue } from '@/context/FamilyProvider';
import { FAMILY_MESSAGES } from '@/lib/family/api';
import { FAKE_BOB, FAKE_ME, fakeFamilyValue } from '@/test-utils/fakeFamily';

import { FamilyScreen } from '../FamilyScreen';

jest.mock('@/lib/profile/pickAvatar', () => ({ pickAvatar: jest.fn() }));

function renderScreen(family: FamilyValue = fakeFamilyValue()) {
  renderRouter(
    {
      _layout: () => (
        <FamilyContext.Provider value={family}>
          <Slot />
        </FamilyContext.Provider>
      ),
      family: FamilyScreen,
      'family/create': () => <Text>Create screen</Text>,
      'family/join': () => <Text>Join screen</Text>,
    },
    { initialUrl: '/family' },
  );
  return family;
}

/** Answer the next Alert by pressing the button with this text. */
function answerAlert(buttonText: string) {
  jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _message, buttons) => {
    buttons?.find(b => b.text === buttonText)?.onPress?.();
  });
}

afterEach(() => jest.restoreAllMocks());

describe('Family tab without a family', () => {
  const alone = () => fakeFamilyValue({ family: null, members: [FAKE_ME], isOwner: false });

  it('offers to create or join', async () => {
    renderScreen(alone());
    fireEvent.press(await screen.findByRole('button', { name: 'Create a family' }));
    expect(await screen.findByText('Create screen')).toBeTruthy();
  });

  it('goes to the join screen', async () => {
    renderScreen(alone());
    fireEvent.press(await screen.findByRole('button', { name: 'Join with a code' }));
    expect(await screen.findByText('Join screen')).toBeTruthy();
  });
});

describe('Family tab in a family', () => {
  it('shows the family, its code and members', async () => {
    renderScreen();
    expect(await screen.findByText('Smiths')).toBeTruthy();
    expect(screen.getByText('K7QM-2XWP')).toBeTruthy();
    expect(screen.getByText('You (owner)')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('@BE')).toBeTruthy();
  });

  it('lets the owner remove a member after confirming', async () => {
    const family = renderScreen();
    answerAlert('Remove');
    fireEvent.press(await screen.findByRole('button', { name: 'Remove Bob' }));
    await waitFor(() => expect(family.removeMember).toHaveBeenCalledWith(FAKE_BOB.id));
  });

  it('lets the owner make a new code after confirming', async () => {
    const family = renderScreen();
    answerAlert('New code');
    fireEvent.press(await screen.findByRole('button', { name: 'New code' }));
    await waitFor(() => expect(family.regenerateInviteCode).toHaveBeenCalled());
  });

  it("doesn't offer owner actions to a member", async () => {
    renderScreen(fakeFamilyValue({ isOwner: false, family: { id: 'fam-1', name: 'Smiths', ownerId: FAKE_BOB.id, inviteCode: 'K7QM2XWP' } }));
    expect(await screen.findByText('Bob (owner)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Bob' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New code' })).toBeNull();
  });

  it('shows why leaving failed', async () => {
    const family = fakeFamilyValue();
    (family.leaveFamily as jest.Mock).mockResolvedValueOnce({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
    renderScreen(family);
    answerAlert('Leave');
    fireEvent.press(await screen.findByRole('button', { name: 'Leave family' }));
    expect(await screen.findByText(FAMILY_MESSAGES.offline)).toBeTruthy();
  });

  it('says when it may be out of date', async () => {
    renderScreen(fakeFamilyValue({ offline: true }));
    expect(await screen.findByText("You're offline, so this may be out of date.")).toBeTruthy();
  });
});

describe('Family tab offline with nothing known', () => {
  it('shows an internet notice instead of the create/join buttons when me is null and offline', async () => {
    renderScreen(
      fakeFamilyValue({
        me: null,
        family: null,
        members: [],
        memberById: new Map(),
        memberByTag: new Map(),
        offline: true,
        loading: false,
      }),
    );
    expect(await screen.findByText('Connect to the internet to see your family.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create a family' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Join with a code' })).toBeNull();
  });
});

describe('Your name and tag', () => {
  it('saves what you typed', async () => {
    const family = renderScreen();
    fireEvent.changeText(await screen.findByLabelText('Your tag'), 'ali');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(family.updateProfile).toHaveBeenCalledWith({ displayName: 'Alice', tag: 'ali' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('shows why it could not save', async () => {
    const family = fakeFamilyValue();
    (family.updateProfile as jest.Mock).mockResolvedValueOnce({ ok: false, message: 'Someone in your family already uses @BE.', offline: false });
    renderScreen(family);
    fireEvent.press(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Someone in your family already uses @BE.')).toBeTruthy();
  });
});
