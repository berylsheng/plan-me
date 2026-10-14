import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { FamilyContext } from '@/context/FamilyProvider';
import { fakeFamilyValue } from '@/test-utils/fakeFamily';

import { avatarColour, avatarText, MemberAvatar } from '../MemberAvatar';

const bob = { id: 'user-2', displayName: 'Bob', tag: 'BE', joinedAt: null };

describe('MemberAvatar', () => {
  it('shows the tag, or the first letter of the name', () => {
    expect(avatarText(bob)).toBe('BE');
    expect(avatarText({ ...bob, tag: null })).toBe('B');
    expect(avatarText({ ...bob, tag: null, displayName: null })).toBe('?');
  });

  it('gives each member the same colour every time', () => {
    expect(avatarColour('user-2')).toBe(avatarColour('user-2'));
    expect(avatarColour('user-2')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('is labelled with the member', () => {
    render(<MemberAvatar member={bob} />);
    expect(screen.getByLabelText('Bob')).toBeTruthy();
  });
});

describe('MemberAvatar with a photo', () => {
  it('shows the photo when the family has a URL for it', () => {
    const withPhoto = { ...bob, avatarPath: 'user-2/p.jpg' };
    render(
      <FamilyContext.Provider value={fakeFamilyValue({ avatarUrl: m => (m.avatarPath ? `https://x/${m.avatarPath}` : null) })}>
        <MemberAvatar member={withPhoto} />
      </FamilyContext.Provider>,
    );
    expect(screen.getByLabelText('Bob')).toBeTruthy();
    expect(screen.queryByText('BE')).toBeNull();
  });

  it('falls back to the tag circle without a URL', () => {
    render(
      <FamilyContext.Provider value={fakeFamilyValue()}>
        <MemberAvatar member={{ ...bob, avatarPath: 'user-2/p.jpg' }} />
      </FamilyContext.Provider>,
    );
    expect(screen.getByText('BE')).toBeTruthy();
  });
});
