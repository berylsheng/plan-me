import { randomUUID } from 'node:crypto';

import { signedInPhone } from '@/test-utils/supabaseTestKit';

import { AVATAR_BUCKET, avatarUrls, deleteAllAvatars, removeAvatar, uploadAvatar } from '../avatars';

// A tiny valid JPEG header is enough: the bucket checks the declared content type, not the pixels.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString('base64');

type Phone = Awaited<ReturnType<typeof signedInPhone>>;

async function family(a: Phone, b: Phone) {
  await a.client.rpc('create_family', { p_name: 'Photos' });
  const { data } = await a.client.from('families').select('invite_code').single();
  await b.client.rpc('join_family', { p_code: data?.invite_code });
}

async function upload(phone: Phone, previous: string | null = null) {
  const result = await uploadAvatar(phone.client, phone.userId, randomUUID(), JPEG, previous);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe('Photos against local Supabase', () => {
  it('saves a photo in your folder and points your profile at it', async () => {
    const alice = await signedInPhone('photo');
    const path = await upload(alice);
    expect(path.startsWith(`${alice.userId}/`)).toBe(true);
    const { data } = await alice.client.from('profiles').select('avatar_url').eq('id', alice.userId).single();
    expect(data?.avatar_url).toBe(path);
    expect(Object.keys(await avatarUrls(alice.client, [path]))).toEqual([path]);
  });

  it('shows your photo to your family and to no one else', async () => {
    const alice = await signedInPhone('photo');
    const bob = await signedInPhone('photo');
    const carol = await signedInPhone('photo');
    await family(alice, bob);
    const path = await upload(alice);
    const url = (await avatarUrls(bob.client, [path]))[path];
    expect(url).toBeDefined();
    expect((await fetch(url)).status).toBe(200);
    expect(await avatarUrls(carol.client, [path])).toEqual({});
  });

  it('stops sharing photos when someone leaves', async () => {
    const alice = await signedInPhone('photo');
    const bob = await signedInPhone('photo');
    await family(alice, bob);
    const alicePath = await upload(alice);
    const bobPath = await upload(bob);
    await bob.client.rpc('leave_family');
    expect(await avatarUrls(bob.client, [alicePath])).toEqual({});
    expect(await avatarUrls(alice.client, [bobPath])).toEqual({});
  });

  it("won't let you write in someone else's folder", async () => {
    const alice = await signedInPhone('photo');
    const bob = await signedInPhone('photo');
    const { error } = await bob.client.storage
      .from(AVATAR_BUCKET)
      .upload(`${alice.userId}/${randomUUID()}.jpg`, Buffer.from(JPEG, 'base64'), { contentType: 'image/jpeg' });
    expect(error).not.toBeNull();
  });

  it('refuses a file over 1 MB', async () => {
    const alice = await signedInPhone('photo');
    const big = Buffer.alloc(1_100_000, 1).toString('base64');
    const result = await uploadAvatar(alice.client, alice.userId, randomUUID(), big, null);
    expect(result.ok).toBe(false);
  });

  it('deletes the old photo when you pick a new one, and both when removed', async () => {
    const alice = await signedInPhone('photo');
    const first = await upload(alice);
    const second = await upload(alice, first);
    const { data } = await alice.client.storage.from(AVATAR_BUCKET).list(alice.userId);
    expect(data?.map(f => `${alice.userId}/${f.name}`)).toEqual([second]);

    expect(await removeAvatar(alice.client, alice.userId, second)).toEqual({ ok: true, value: undefined });
    const { data: after } = await alice.client.from('profiles').select('avatar_url').eq('id', alice.userId).single();
    expect(after?.avatar_url).toBeNull();
    expect(await deleteAllAvatars(alice.client, alice.userId)).toEqual({ ok: true, removed: 0 });
  });
});
