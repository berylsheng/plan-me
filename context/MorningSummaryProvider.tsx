import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { AppState } from 'react-native';

import type { KeyValueStorage } from '@/lib/events/store';
import { expoNotifier, type Notifier } from '@/lib/notifications/notifier';
import { plannedSummaries } from '@/lib/notifications/schedule';
import { loadSummarySettings, saveSummarySettings, type SummarySettings } from '@/lib/notifications/settings';

import { useAuth } from './AuthProvider';
import { useEvents } from './EventsProvider';

type MorningSummaryValue = {
  /** Null while loading or signed out. */
  settings: SummarySettings | null;
  /** True when notifications are refused for the app in iOS. */
  permissionDenied: boolean;
  setEnabled: (on: boolean) => Promise<void>;
  setTime: (time: string) => Promise<void>;
};

const MorningSummaryContext = createContext<MorningSummaryValue | null>(null);

type Props = { children: React.ReactNode; notifier?: Notifier; storage?: KeyValueStorage; delayMs?: number };

/** Keeps the phone's scheduled morning summaries in step with the events and the setting. */
export function MorningSummaryProvider({ children, notifier = expoNotifier, storage = AsyncStorage, delayMs = 2000 }: Props) {
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { records, status } = useEvents();
  const eventsLoading = status.state === 'loading';
  const [settings, setSettings] = useState<SummarySettings | null>(null);
  // The latest settings, so two quick changes (on, then a new time) build on each other.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [wakes, setWakes] = useState(0);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const queue = useRef<Promise<void>>(Promise.resolve());

  // One at a time, so a cancel never runs in the middle of another schedule.
  const run = useCallback((job: () => Promise<void>) => {
    queue.current = queue.current.then(job).catch(() => undefined);
    return queue.current;
  }, []);

  useEffect(() => {
    notifier.showWhileOpen();
  }, [notifier]);

  // Tapping a summary opens the planner on that day. `at` marks each tap, so the same summary tapped again still moves it.
  const taps = useRef(0);
  useEffect(
    () =>
      notifier.onSummaryTapped(dateKey => {
        taps.current += 1;
        router.navigate({ pathname: '/', params: { date: dateKey, at: `${Date.now()}-${taps.current}` } });
      }),
    [notifier],
  );

  useEffect(() => {
    setSettings(null);
    setPermissionDenied(false);
    if (!userId) {
      // Only once sign-in has settled: at launch the user is unknown for a moment, and cancelling
      // then would leave nothing scheduled if the app is closed before it reschedules.
      if (!authLoading) void run(() => notifier.cancelSummaries());
      return;
    }
    let live = true;
    void loadSummarySettings(storage, userId).then(loaded => {
      if (live) setSettings(loaded);
    });
    return () => {
      live = false;
    };
  }, [userId, authLoading, storage, notifier, run]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setWakes(n => n + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    // Wait for the stored events, so a run with none yet doesn't clear the scheduled summaries.
    if (!userId || !settings || eventsLoading) return;
    const timer = setTimeout(() => {
      void run(async () => {
        // Read permission first, so coming back from iOS Settings clears the message.
        const granted = (await notifier.permission()) === 'granted';
        if (granted) setPermissionDenied(false);
        await notifier.cancelSummaries();
        if (!settings.enabled) return;
        if (!granted) {
          setPermissionDenied(true);
          return;
        }
        await notifier.scheduleSummaries(plannedSummaries(recordsRef.current, { time: settings.time, now: new Date() }));
      });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [userId, settings, records, eventsLoading, wakes, delayMs, notifier, run]);

  const save = useCallback(
    async (next: SummarySettings) => {
      if (!userId) return;
      settingsRef.current = next;
      setSettings(next);
      await saveSummarySettings(storage, userId, next);
    },
    [storage, userId],
  );

  const setEnabled = useCallback(
    async (on: boolean) => {
      if (!settingsRef.current) return;
      if (on) {
        const granted = (await notifier.requestPermission()) === 'granted';
        setPermissionDenied(!granted);
        if (!granted) return;
      } else {
        setPermissionDenied(false);
      }
      if (settingsRef.current) await save({ ...settingsRef.current, enabled: on });
    },
    [notifier, save],
  );

  const setTime = useCallback(
    async (time: string) => {
      if (settingsRef.current) await save({ ...settingsRef.current, time });
    },
    [save],
  );

  const value = useMemo(() => ({ settings, permissionDenied, setEnabled, setTime }), [settings, permissionDenied, setEnabled, setTime]);
  return <MorningSummaryContext.Provider value={value}>{children}</MorningSummaryContext.Provider>;
}

export function useMorningSummary(): MorningSummaryValue {
  const value = useContext(MorningSummaryContext);
  if (!value) throw new Error('useMorningSummary must be used inside <MorningSummaryProvider>');
  return value;
}
