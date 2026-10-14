import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { FamilyContext } from '@/context/FamilyProvider';
import { FAMILY_MESSAGES } from '@/lib/family/api';
import { fakeFamilyValue } from '@/test-utils/fakeFamily';

import CreateFamilyScreen from '../../../app/family/create';
import JoinFamilyScreen from '../../../app/family/join';

function renderAt(url: string, family = fakeFamilyValue({ family: null })) {
  renderRouter(
    {
      _layout: () => (
        <FamilyContext.Provider value={family}>
          <Slot />
        </FamilyContext.Provider>
      ),
      family: () => <Text>Family tab</Text>,
      'family/create': CreateFamilyScreen,
      'family/join': JoinFamilyScreen,
    },
    { initialUrl: url },
  );
  return family;
}

describe('Create a family', () => {
  it('creates the family and goes back to the Family tab', async () => {
    const family = renderAt('/family/create');
    fireEvent.changeText(screen.getByLabelText('Family name'), 'Smiths');
    fireEvent.press(screen.getByRole('button', { name: 'Create family' }));
    expect(await screen.findByText('Family tab')).toBeTruthy();
    expect(family.createFamily).toHaveBeenCalledWith('Smiths');
  });

  it('shows why it could not', async () => {
    const family = fakeFamilyValue({ family: null });
    (family.createFamily as jest.Mock).mockResolvedValueOnce({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
    renderAt('/family/create', family);
    fireEvent.press(screen.getByRole('button', { name: 'Create family' }));
    expect(await screen.findByText(FAMILY_MESSAGES.offline)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create family' })).not.toBeDisabled();
  });
});

describe('Join a family', () => {
  it('joins with the typed code', async () => {
    const family = renderAt('/family/join');
    fireEvent.changeText(screen.getByLabelText('Invite code'), 'k7qm-2xwp');
    fireEvent.press(screen.getByRole('button', { name: 'Join family' }));
    expect(await screen.findByText('Family tab')).toBeTruthy();
    expect(family.joinFamily).toHaveBeenCalledWith('k7qm-2xwp');
  });

  it('explains a code that is not found', async () => {
    const family = fakeFamilyValue({ family: null });
    (family.joinFamily as jest.Mock).mockResolvedValueOnce({ ok: false, message: FAMILY_MESSAGES.codeNotFound, offline: false });
    renderAt('/family/join', family);
    fireEvent.changeText(screen.getByLabelText('Invite code'), 'ZZZZZZZZ');
    fireEvent.press(screen.getByRole('button', { name: 'Join family' }));
    await waitFor(() => expect(screen.getByText(FAMILY_MESSAGES.codeNotFound)).toBeTruthy());
  });
});
