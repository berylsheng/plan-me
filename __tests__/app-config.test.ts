import appJson from '../app.json';

// Settings Apple checks at review; changing any of them needs a new store build (CHG-005).
const { expo } = appJson as unknown as {
  expo: {
    name: string;
    ios: { bundleIdentifier?: string; supportsTablet?: boolean; config?: { usesNonExemptEncryption?: boolean }; infoPlist?: Record<string, string> };
    android: { package?: string; permissions?: string[]; blockedPermissions?: string[] };
    plugins: unknown[];
    runtimeVersion?: unknown;
    updates?: { url?: string };
    extra?: { eas?: { projectId?: string } };
  };
};

describe('app.json for the App Store', () => {
  it('uses the final name and bundle identifier', () => {
    expect(expo.name).toBe('Plan-Me');
    expect(expo.ios.bundleIdentifier).toBe('com.berylsheng.planme');
    expect(expo.android.package).toBe('com.berylsheng.planme');
  });

  it('is an iPhone-only app', () => {
    expect(expo.ios.supportsTablet).toBe(false);
  });

  it('declares no non-exempt encryption', () => {
    expect(expo.ios.config?.usesNonExemptEncryption).toBe(false);
  });

  it("doesn't ask for the microphone or speech recognition", () => {
    const plist = Object.keys(expo.ios.infoPlist ?? {});
    expect(plist.filter(key => /Microphone|SpeechRecognition/.test(key))).toEqual([]);
    expect(expo.android.permissions ?? []).not.toContain('android.permission.RECORD_AUDIO');
  });

  it('lists each blocked Android permission once', () => {
    const blocked = expo.android.blockedPermissions ?? [];
    expect(blocked).toEqual([...new Set(blocked)]);
  });

  it('gets over-the-air updates from its EAS project, matched by native fingerprint', () => {
    const projectId = expo.extra?.eas?.projectId;
    expect(projectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(expo.updates?.url).toBe(`https://u.expo.dev/${projectId}`);
    // A JS update only reaches builds with the same native code; fingerprint works that out itself.
    expect(expo.runtimeVersion).toEqual({ policy: 'fingerprint' });
  });

  it('signs notifications for production builds', () => {
    expect(expo.plugins).toContainEqual(['expo-notifications', { mode: 'production' }]);
  });
});
