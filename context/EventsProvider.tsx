import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { AuthResult } from '@/lib/auth/api';
import { DELETE_AUTH, DELETE_OFFLINE, deleteAccount } from '@/lib/auth/api';
import { newUuid } from '@/lib/events/ids';
import { clearFamilyData } from '@/lib/family/cache';
import {
  activeClaim,
  claimLegacy as claimLegacyEvents,
  claimSynced,
  declineLegacy as declineLegacyEvents,
  dropFromClaim,
  finishLegacyClaim,
  legacyOffer,
  markClaimQueued,
  releaseLegacyClaim,
} from '@/lib/events/legacy';
import { type EventInput, type EventRecord, type FormChanges, newRecord, recordsToItems } from '@/lib/events/rows';
import { deleteAllAvatars } from '@/lib/profile/avatars';
import type { KeyValueStorage } from '@/lib/events/store';
import { INITIAL_STATUS, SyncEngine, type SyncEngineLike, type SyncEngineOptions, type SyncStatus } from '@/lib/events/syncEngine';
import type { ItemsByDate } from '@/lib/events/types';

import { useAuth } from './AuthProvider';

type EventsValue = {
  items: ItemsByDate;
  records: Record<string, EventRecord>;
  status: SyncStatus;
  addEvents: (events: EventInput[]) => void;
  updateEvent: (event: EventInput) => void;
  deleteEvents: (ids: string[]) => void;
  /** Save one edit from the event form; true once it's stored on the phone. */
  saveEventChanges: (changes: FormChanges) => Promise<boolean>;
  /** Fetch everything visible again (after joining or leaving a family). */
  refresh: () => void;
  /** Sign out, then delete this user's events and queued changes from the phone. */
  signOutAndForget: () => Promise<AuthResult>;
  /** Delete the account on the server, then forget this user's data on the phone and sign out. */
  deleteAccountAndForget: () => Promise<AuthResult>;
  legacy: { count: number } | null;
  claimLegacy: () => Promise<void>;
  declineLegacy: () => Promise<void>;
};

const EventsContext = createContext<EventsValue | null>(null);

const defaultCreateEngine = (options: SyncEngineOptions): SyncEngineLike => new SyncEngine(options);

/** An event from the planner laid over the stored record: its fields win, who sees it stays unless given. */
const withInput = (existing: EventRecord, event: EventInput): EventRecord => ({
  ...existing,
  dateKey: event.dateKey,
  name: event.name,
  startTime: event.startTime,
  endTime: event.endTime,
  people: event.people,
  occurrenceId: event.occurrenceId,
  repeat: event.repeat,
  visibility: event.visibility ?? existing.visibility,
  memberIds: event.memberIds ?? existing.memberIds,
});

type Props = {
  children: React.ReactNode;
  storage?: KeyValueStorage;
  createEngine?: (options: SyncEngineOptions) => SyncEngineLike;
};

export function EventsProvider({ children, storage = AsyncStorage, createEngine = defaultCreateEngine }: Props) {
  const { client, user, session, signOut } = useAuth();
  const userId = user?.id ?? null;
  const accessToken = session?.access_token ?? null;
  // Track the userId alongside the records and status so a stale onChange from a stopped engine
  // cannot show the previous user's events or status on the next user's screen.
  const [engineState, setEngineState] = useState<{
    userId: string | null;
    records: Record<string, EventRecord>;
    status: SyncStatus;
  }>({ userId: null, records: {}, status: INITIAL_STATUS });
  const sameUser = engineState.userId === userId;
  const records = useMemo(
    () => (sameUser ? engineState.records : {}),
    [sameUser, engineState.records],
  );
  const status = sameUser ? engineState.status : INITIAL_STATUS;
  const engineRef = useRef<SyncEngineLike | null>(null);
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const statusRef = useRef(status);
  statusRef.current = status;

  // Offer keyed by userId: a different user never sees a stale offer.
  const [legacyState, setLegacyState] = useState<{ userId: string; offer: { count: number } | null } | null>(null);
  const legacy = legacyState !== null && legacyState.userId === userId ? legacyState.offer : null;

  // Ask each account about the pre-accounts events, until someone claims them.
  useEffect(() => {
    setLegacyState(null);
    if (!userId) return;
    let active = true;
    legacyOffer(storage, userId).then(offer => {
      if (active) setLegacyState({ userId, offer });
    });
    return () => {
      active = false;
    };
  }, [userId, storage]);

  // Re-queue claimed records after a crash: active claim present but records missing from the engine.
  // Keyed on the engine instance so it runs exactly once per engine and never after the user deletes the event.
  const requeueDoneForRef = useRef<SyncEngineLike | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!sameUser || status.state === 'loading' || !userId || !engine) return;
    if (requeueDoneForRef.current === engine) return;
    requeueDoneForRef.current = engine;
    activeClaim(storage, userId).then(claim => {
      if (engineRef.current !== engine) return;
      if (!claim) return;
      if (claim.queued) return;
      const fullFetchDone =
        status.pending === 0 &&
        status.lastSyncedAt !== null &&
        Date.parse(status.lastSyncedAt) > Date.parse(claim.claimedAt);
      const missing = claim.records.filter(r => !(r.id in records));
      if (missing.length > 0 && !fullFetchDone) {
        void engine.create(missing).then(saved => {
          if (saved && engineRef.current === engine) return markClaimQueued(storage, userId);
        }).catch(() => undefined);
      }
    }).catch(() => undefined);
  }, [sameUser, status, records, storage, userId]);

  // Once a claim has synced (the server has every claimed id), remove the old copy.
  const finishRunningRef = useRef(false);
  useEffect(() => {
    if (!sameUser || !userId) return;
    if (finishRunningRef.current) return;
    finishRunningRef.current = true;
    activeClaim(storage, userId).then(claim => {
      if (claim && claimSynced(claim, records, status)) {
        return finishLegacyClaim(storage, userId);
      }
    }).catch(() => undefined).finally(() => {
      finishRunningRef.current = false;
    });
  }, [sameUser, records, status, storage, userId]);

  const claimLegacyRef = useRef(false);
  const claimLegacy = useCallback(async () => {
    if (claimLegacyRef.current) return;
    const engine = engineRef.current;
    const uid = userId;
    if (!uid || !engine) throw new Error('engine not ready');
    claimLegacyRef.current = true;
    try {
      const claimed = await claimLegacyEvents(storage, uid, newUuid);
      if (engineRef.current !== engine) return;
      setLegacyState(null);
      if (claimed.length > 0) {
        const saved = await engine.create(claimed.filter(r => !(r.id in recordsRef.current)));
        if (saved && engineRef.current === engine) {
          await markClaimQueued(storage, uid);
        }
      }
    } finally {
      claimLegacyRef.current = false;
    }
  }, [userId, storage]);

  const declineLegacy = useCallback(async () => {
    if (!userId) return;
    await declineLegacyEvents(storage, userId);
    setLegacyState(null);
  }, [userId, storage]);

  // One engine per signed-in user; a different user gets a fresh engine and their own storage.
  useEffect(() => {
    setEngineState({ userId: null, records: {}, status: INITIAL_STATUS });
    finishRunningRef.current = false;
    if (!userId) return;
    const engine = createEngine({
      client,
      userId,
      storage,
      canSync: tokenRef.current !== null,
      onChange: (next, nextStatus) => {
        setEngineState({ userId, records: next, status: nextStatus });
      },
    });
    engineRef.current = engine;
    void engine.start();
    return () => {
      engine.stop();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [client, userId, storage, createEngine]);

  // A session arrived or was refreshed: changes can go out now.
  useEffect(() => {
    engineRef.current?.setCanSync(accessToken !== null);
  }, [accessToken]);

  // Back in the foreground: catch up.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void engineRef.current?.sync(true);
    });
    return () => subscription.remove();
  }, []);

  const addEvents = useCallback(
    (events: EventInput[]) => {
      if (!userId) return;
      void engineRef.current?.create(events.map(event => newRecord(event, userId)));
    },
    [userId],
  );

  const updateEvent = useCallback((event: EventInput) => {
    const existing = recordsRef.current[event.id];
    if (!existing) return;
    void engineRef.current?.update(withInput(existing, event));
  }, []);

  const deleteEvents = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    void engineRef.current?.remove(ids);
    if (userId) void dropFromClaim(storage, userId, ids).catch(() => undefined);
  }, [storage, userId]);

  const saveEventChanges = useCallback(
    async (changes: FormChanges): Promise<boolean> => {
      const engine = engineRef.current;
      if (!userId || !engine) return false;
      // An event deleted elsewhere meanwhile is skipped rather than brought back.
      const update = changes.update.flatMap(event => {
        const existing = recordsRef.current[event.id];
        return existing ? [withInput(existing, event)] : [];
      });
      const saved = await engine.apply({ remove: changes.remove, update, create: changes.create.map(event => newRecord(event, userId)) });
      // Only a stored edit has removed anything; a failed one leaves the claimed events as they were.
      if (saved && changes.remove.length > 0) void dropFromClaim(storage, userId, changes.remove).catch(() => undefined);
      return saved;
    },
    [storage, userId],
  );

  const refresh = useCallback(() => {
    void engineRef.current?.sync(true);
  }, []);

  const signOutAndForget = useCallback(async () => {
    const currentEngine = engineRef.current;
    const currentUserId = userId;
    const currentRecords = recordsRef.current;
    const currentStatus = statusRef.current;
    const result = await signOut();
    if (result.ok) {
      if (currentUserId) {
        const claim = await activeClaim(storage, currentUserId);
        if (claim && !claimSynced(claim, currentRecords, currentStatus)) {
          await releaseLegacyClaim(storage, currentUserId);
        }
      }
      await currentEngine?.clearLocalData();
      if (currentUserId) await clearFamilyData(storage, currentUserId).catch(() => undefined);
    }
    return result;
  }, [signOut, userId, storage]);

  const deleteAccountAndForget = useCallback(async (): Promise<AuthResult> => {
    const currentEngine = engineRef.current;
    const currentUserId = userId;
    if (!currentUserId) return { ok: false, message: 'Sign in again to do this.' };
    // Photos first: once the account is gone the app can't authenticate to Storage (ruling R4).
    const photos = await deleteAllAvatars(client, currentUserId);
    if (!photos.ok) {
      const message =
        photos.reason === 'offline' ? DELETE_OFFLINE : photos.reason === 'auth' ? DELETE_AUTH : "Couldn't delete your photo. Try again.";
      return { ok: false, code: photos.reason, message };
    }
    const result = await deleteAccount(client);
    if (!result.ok) {
      if (photos.removed === 0) return result;
      // Best-effort: null the profile pointer so it doesn't reference a now-deleted file.
      try {
        await client.from('profiles').update({ avatar_url: null }).eq('id', currentUserId);
      } catch {
        // Ignore — the file is already gone from Storage.
      }
      return { ok: false, message: `${result.message} Your photo was removed.`, code: result.code };
    }
    try {
      await currentEngine?.clearLocalData();
      await clearFamilyData(storage, currentUserId).catch(() => undefined);
      // The old pre-accounts events (if this account claimed them) can be offered to the next account.
      if (await activeClaim(storage, currentUserId).catch(() => null)) {
        await releaseLegacyClaim(storage, currentUserId).catch(() => undefined);
      }
    } finally {
      // The server already ended the session; this clears it on the phone.
      await signOut();
    }
    return { ok: true };
  }, [client, signOut, userId, storage]);

  const items = useMemo(() => recordsToItems(records), [records]);
  const value = useMemo(
    () => ({ items, records, status, addEvents, updateEvent, deleteEvents, saveEventChanges, refresh, signOutAndForget, deleteAccountAndForget, legacy, claimLegacy, declineLegacy }),
    [items, records, status, addEvents, updateEvent, deleteEvents, saveEventChanges, refresh, signOutAndForget, deleteAccountAndForget, legacy, claimLegacy, declineLegacy],
  );
  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

export function useEvents(): EventsValue {
  const value = useContext(EventsContext);
  if (!value) throw new Error('useEvents must be used inside <EventsProvider>');
  return value;
}
