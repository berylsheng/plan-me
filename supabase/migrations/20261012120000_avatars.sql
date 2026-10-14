-- FEAT-002 Plan 6: profile photos. Private bucket; the owner writes their folder,
-- the owner and their current family read it. Paths: <user id>/<random uuid>.jpg

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

-- The first folder of the path is the owner's user id.
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Read: your own photos, and those of people currently in your family.
create policy avatars_select_family on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.profiles p
         where p.id::text = (storage.foldername(name))[1]
           and p.family_id is not null
           and p.family_id = public.my_family_id()
      )
    )
  );
