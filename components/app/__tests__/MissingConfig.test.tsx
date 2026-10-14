import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { MissingConfig } from '../MissingConfig';

const mockHide = jest.fn(async () => true);
jest.mock('expo-router', () => ({ SplashScreen: { hideAsync: () => mockHide() } }));

describe('MissingConfig', () => {
  it('explains the build is missing its server settings, and which ones', () => {
    render(<MissingConfig missing={['EXPO_PUBLIC_SUPABASE_URL']} />);
    expect(screen.getByText("Plan-Me can't start")).toBeTruthy();
    expect(screen.getByText('This build is missing its server settings.')).toBeTruthy();
    expect(screen.getByText('EXPO_PUBLIC_SUPABASE_URL')).toBeTruthy();
  });

  it('hides the splash screen, which otherwise waits for sign-in', () => {
    render(<MissingConfig missing={['EXPO_PUBLIC_SUPABASE_URL']} />);
    expect(mockHide).toHaveBeenCalled();
  });
});
