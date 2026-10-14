import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { newUuid } from '@/lib/events/ids';
import type { KeyValueStorage } from '@/lib/events/store';
import { FAMILY_MESSAGES, type FamilyApi, familyApi, type ProfileChanges } from '@/lib/family/api';
import { readFamilyCache, writeFamilyCache } from '@/lib/family/cache';
import type { Family, FamilyResult, FamilySnapshot, Member } from '@/lib/family/types';

import { useAuth } from './AuthProvider';
import { useEvents } from './EventsProvider';

export type FamilyValue = {
  me: Member | null;
  family: Family | null;
  /** Everyone in the family, you included; just you when there's no family. */
  members: Member[];
  isOwner: boolean;
  /** Nothing known yet: no cached family and the first fetch hasn't come back. */
  loading: boolean;
  /** The last fetch couldn't reach the server, so what's shown may be out of date. */
  offline: boolean;
  memberById: ReadonlyMap<string, Member>;
  memberByTag: ReadonlyMap<string, Member>;
  refresh: () => Promise<void>;
  createFamily: (name: string) => Promise<FamilyResult>;
  joinFamily: (code: string) => Promise<FamilyResult>;
  leaveFamily: () => Promise<FamilyResult>;
  removeMember: (memberId: string) => Promise<FamilyResult>;
  regenerateInviteCode: () => Promise<FamilyResult<string>>;
  updateProfile: (changes: ProfileChanges) => Promise<FamilyResult>;
  /** A short-lived URL for this member's photo, or null (no photo, offline, or not loaded yet). */
  avatarUrl: (member: Member) => string | null;
  setAvatar: (base64: string) => Promise<FamilyResult>;
  removeAvatar: () => Promise<FamilyResult>;
};

export const FamilyContext = createContext<FamilyValue | null>(null);

type State = { userId: string | null; snapshot: FamilySnapshot | null; fetched: boolean; offline: boolean };

type Props = { children: React.ReactNode; storage?: KeyValueStorage; api?: FamilyApi };

/** The signed-in user's family. Kept per user on the phone so the planner knows the tags offline. */
export function FamilyProvider({ children, storage = AsyncStorage, api = familyApi }: Props) {
  const { client, user, session, offline: authOffline } = useAuth();
  const { refresh: refreshEvents, records, status } = useEvents();
  const userId = user?.id ?? null;
  const hasSession = session !== null;
  const [state, setState] = useState<State>({ userId: null, snapshot: null, fetched: false, offline: false });
  // State belongs to one user; anything else is treated as nothing known yet.
  const current = state.userId === userId ? state : null;
  // Signed photo URLs belong to one user, like the family state.
  const [avatarState, setAvatarState] = useState<{ userId: string | null; urls: Record<string, string> }>({ userId: null, urls: {} });

  const userRef = useRef(userId);
  userRef.current = userId;
  const sessionRef = useRef(hasSession);
  sessionRef.current = hasSession;
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const uid = userRef.current;
    if (!uid || !sessionRef.current) return;
    const request = ++requestRef.current;
    const result = await api.fetchFamily(client, uid);
    // A newer request, or a different user, wins.
    if (request !== requestRef.current || userRef.current !== uid) return;
    if (result.ok) {
      setState({ userId: uid, snapshot: result.value, fetched: true, offline: false });
      const paths = result.value.members.flatMap(m => (m.avatarPath ? [m.avatarPath] : []));
      void api.avatarUrls(client, paths).then(urls => {
        if (userRef.current === uid) setAvatarState({ userId: uid, urls });
      });
      void writeFamilyCache(storage, uid, result.value).catch(() => undefined);
    } else {
      setState(prev =>
        prev.userId === uid
          ? { ...prev, fetched: true, offline: result.offline }
          : { userId: uid, snapshot: null, fetched: true, offline: result.offline },
      );
    }
  }, [api, client, storage]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // A different user: start from their cached family while the server is asked.
  useEffect(() => {
    requestRef.current += 1; // answers for the previous user are ignored
    setState({ userId, snapshot: null, fetched: false, offline: false });
    setAvatarState({ userId, urls: {} });
    if (!userId) return;
    let active = true;
    readFamilyCache(storage, userId).then(cached => {
      if (active && cached) setState(prev => (prev.userId === userId && !prev.snapshot ? { ...prev, snapshot: cached } : prev));
    });
    return () => {
      active = false;
    };
  }, [userId, storage]);

  // Signed in (or a session arrived after an offline start): ask the server.
  useEffect(() => {
    if (userId && hasSession) void refreshRef.current();
  }, [userId, hasSession]);

  // Back in the foreground: someone may have joined, or removed you.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', appState => {
      if (appState === 'active') void refreshRef.current();
    });
    return () => subscription.remove();
  }, []);

  // Derived from snapshot — declared here so the two effects below can use memberById.
  const snapshot = current?.snapshot ?? null;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const memberById = useMemo(() => new Map((snapshot?.members ?? []).map(m => [m.id, m])), [snapshot]);

  // Track which unknown member ids we have already asked about (reset on user change).
  const askedRef = useRef(new Set<string>());
  useEffect(() => {
    askedRef.current = new Set();
  }, [userId]);

  // Refresh when records contain member ids not in the current snapshot.
  // Ids still unknown after the refresh (former members) are never asked about again.
  useEffect(() => {
    if (!hasSession) return;
    const unknownIds: string[] = [];
    for (const record of Object.values(records)) {
      const ids = [record.ownerId, ...(record.memberIds ?? [])];
      for (const id of ids) {
        if (id && !memberById.has(id) && !askedRef.current.has(id)) {
          unknownIds.push(id);
        }
      }
    }
    if (unknownIds.length === 0) return;
    const timer = setTimeout(() => {
      for (const id of unknownIds) askedRef.current.add(id);
      void refreshRef.current();
    }, 2_000);
    return () => clearTimeout(timer);
  }, [records, memberById, hasSession]);

  // Refresh when the server starts refusing ops (may have been removed from the family).
  const refusedRef = useRef(status.refused ?? 0);
  useEffect(() => {
    const prev = refusedRef.current;
    const next = status.refused ?? 0;
    refusedRef.current = next;
    if (!hasSession || next <= prev) return;
    const timer = setTimeout(() => void refreshRef.current(), 2_000);
    return () => clearTimeout(timer);
  }, [status.refused, hasSession]);

  const withUser = useCallback(
    async <T,>(call: (uid: string) => Promise<FamilyResult<T>>, membershipChanged: boolean): Promise<FamilyResult<T>> => {
      const uid = userRef.current;
      if (!uid) return { ok: false, message: FAMILY_MESSAGES.signInAgain, offline: false };
      const result = await call(uid);
      if (result.ok) {
        await refresh();
        // Joining or leaving changes which shared events this user can see.
        if (membershipChanged) refreshEvents();
      }
      return result;
    },
    [refresh, refreshEvents],
  );

  const createFamily = useCallback((name: string) => withUser(() => api.createFamily(client, name), true), [withUser, api, client]);
  const joinFamily = useCallback((code: string) => withUser(() => api.joinFamily(client, code), true), [withUser, api, client]);
  const leaveFamily = useCallback(() => withUser(() => api.leaveFamily(client), true), [withUser, api, client]);
  const removeMember = useCallback(
    (memberId: string) => withUser(() => api.removeMember(client, memberId), false),
    [withUser, api, client],
  );
  const regenerateInviteCode = useCallback(() => withUser(() => api.regenerateInviteCode(client), false), [withUser, api, client]);
  const updateProfile = useCallback(
    (changes: ProfileChanges) => withUser(uid => api.updateProfile(client, uid, changes), false),
    [withUser, api, client],
  );
  const setAvatar = useCallback(
    (base64: string) =>
      withUser(async uid => {
        const result = await api.uploadAvatar(client, uid, newUuid(), base64, snapshotRef.current?.me.avatarPath ?? null);
        return result.ok ? { ok: true as const, value: undefined } : result;
      }, false),
    [withUser, api, client],
  );
  const removeAvatar = useCallback(
    () => withUser(uid => api.removeAvatar(client, uid, snapshotRef.current?.me.avatarPath ?? null), false),
    [withUser, api, client],
  );
  const urls = avatarState.userId === userId ? avatarState.urls : null;
  const avatarUrl = useCallback(
    (member: Member) => (member.avatarPath && urls ? urls[member.avatarPath] ?? null : null),
    [urls],
  );

  const memberByTag = useMemo(
    () => new Map((snapshot?.members ?? []).flatMap(m => (m.tag ? [[m.tag, m] as const] : []))),
    [snapshot],
  );

  const value = useMemo<FamilyValue>(
    () => ({
      me: snapshot?.me ?? null,
      family: snapshot?.family ?? null,
      members: snapshot?.members ?? [],
      isOwner: !!snapshot?.family && snapshot.family.ownerId === userId,
      loading: !snapshot && hasSession && !(current?.fetched ?? false),
      offline: (current?.offline ?? false) || authOffline,
      memberById,
      memberByTag,
      refresh,
      createFamily,
      joinFamily,
      leaveFamily,
      removeMember,
      regenerateInviteCode,
      updateProfile,
      avatarUrl,
      setAvatar,
      removeAvatar,
    }),
    [snapshot, userId, hasSession, current?.fetched, current?.offline, authOffline, memberById, memberByTag, refresh, createFamily, joinFamily, leaveFamily, removeMember, regenerateInviteCode, updateProfile, avatarUrl, setAvatar, removeAvatar],
  );
  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

export function useFamily(): FamilyValue {
  const value = useContext(FamilyContext);
  if (!value) throw new Error('useFamily must be used inside <FamilyProvider>');
  return value;
}
