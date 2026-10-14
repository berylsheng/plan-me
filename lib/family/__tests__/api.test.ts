import type { SupabaseClient } from '@supabase/supabase-js';

import { createFamily, FAMILY_MESSAGES, joinFamily, regenerateInviteCode, updateProfile } from '../api';

type Response = { data: unknown; error: { code?: string; message?: string } | null; status: number };

function rpcClient(response: Response | Error) {
  const rpc = jest.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

const ok = (data: unknown): Response => ({ data, error: null, status: 200 });

describe('joinFamily', () => {
  it.each([
    ['invalid_code', FAMILY_MESSAGES.codeNotFound],
    ['rate_limited', FAMILY_MESSAGES.rateLimited],
    ['already_in_family', FAMILY_MESSAGES.alreadyInFamily],
  ])('explains %s', async (status, message) => {
    const { client } = rpcClient(ok(status));
    expect(await joinFamily(client, 'K7QM2XWP')).toEqual({ ok: false, message, offline: false });
  });

  it('sends the normalised code', async () => {
    const { client, rpc } = rpcClient(ok('joined'));
    expect(await joinFamily(client, 'k7qm-2xwp')).toEqual({ ok: true, value: undefined });
    expect(rpc).toHaveBeenCalledWith('join_family', { p_code: 'K7QM2XWP' });
  });

  it('checks the code before calling the server', async () => {
    const { client, rpc } = rpcClient(ok('joined'));
    expect(await joinFamily(client, 'abc')).toEqual({
      ok: false,
      message: 'Invite codes are 8 letters and numbers, like K7QM-2XWP.',
      offline: false,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says offline when the request can't be sent", async () => {
    const { client } = rpcClient(new TypeError('Network request failed'));
    expect(await joinFamily(client, 'K7QM2XWP')).toEqual({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
  });

  it('says offline when supabase-js reports a failed fetch', async () => {
    const { client } = rpcClient({ data: null, error: { message: 'TypeError: Network request failed' }, status: 0 });
    expect(await joinFamily(client, 'K7QM2XWP')).toEqual({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
  });
});

describe('createFamily', () => {
  it('explains a raised already_in_family', async () => {
    const { client } = rpcClient({ data: null, error: { code: 'P0001', message: 'already_in_family' }, status: 400 });
    expect(await createFamily(client, 'Smiths')).toEqual({ ok: false, message: FAMILY_MESSAGES.alreadyInFamily, offline: false });
  });

  it('sends the trimmed name', async () => {
    const { client, rpc } = rpcClient(ok('fam-1'));
    await createFamily(client, '  Smiths ');
    expect(rpc).toHaveBeenCalledWith('create_family', { p_name: 'Smiths' });
  });
});

describe('regenerateInviteCode', () => {
  it('returns the new code', async () => {
    const { client } = rpcClient(ok('P3RT8VWX'));
    expect(await regenerateInviteCode(client)).toEqual({ ok: true, value: 'P3RT8VWX' });
  });

  it('explains not_family_owner', async () => {
    const { client } = rpcClient({ data: null, error: { code: 'P0001', message: 'not_family_owner' }, status: 400 });
    expect(await regenerateInviteCode(client)).toEqual({ ok: false, message: FAMILY_MESSAGES.notOwner, offline: false });
  });
});

describe('updateProfile', () => {
  function tableClient(response: Response) {
    const eq = jest.fn(async () => response);
    const update = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ update }));
    return { client: { from } as unknown as SupabaseClient, update, eq };
  }

  it('saves a trimmed name and a normalised tag', async () => {
    const { client, update, eq } = tableClient(ok(null));
    expect(await updateProfile(client, 'user-1', { displayName: ' Alice ', tag: '@al' })).toEqual({ ok: true, value: undefined });
    expect(update).toHaveBeenCalledWith({ display_name: 'Alice', tag: 'AL' });
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('clears an empty name and tag', async () => {
    const { client, update } = tableClient(ok(null));
    await updateProfile(client, 'user-1', { displayName: '', tag: '' });
    expect(update).toHaveBeenCalledWith({ display_name: null, tag: null });
  });

  it('says which tag is taken', async () => {
    const { client } = tableClient({ data: null, error: { code: '23505', message: 'duplicate key' }, status: 409 });
    expect(await updateProfile(client, 'user-1', { displayName: 'Alice', tag: 'BE' })).toEqual({
      ok: false,
      message: 'Someone in your family already uses @BE.',
      offline: false,
    });
  });

  it('checks the tag before calling the server', async () => {
    const { client, update } = tableClient(ok(null));
    expect(await updateProfile(client, 'user-1', { displayName: 'Alice', tag: 'A' })).toEqual({
      ok: false,
      message: 'A tag is 2 to 4 letters, like AZ.',
      offline: false,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
