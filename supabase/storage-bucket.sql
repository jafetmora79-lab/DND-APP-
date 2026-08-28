-- Run this in the SQL editor if the maps bucket is missing.
insert into storage.buckets (id, name, public)
values ('maps', 'maps', true)
on conflict (id) do update set public = true;

drop policy if exists maps_public_read on storage.objects;
drop policy if exists maps_dm_write on storage.objects;
drop policy if exists maps_dm_update on storage.objects;
drop policy if exists maps_dm_delete on storage.objects;

create policy maps_public_read on storage.objects
  for select using (bucket_id = 'maps');
create policy maps_dm_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'maps');
create policy maps_dm_update on storage.objects
  for update to authenticated
  using (bucket_id = 'maps');
create policy maps_dm_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'maps');

insert into storage.buckets (id, name, public)
values ('pdfs', 'pdfs', true)
on conflict (id) do update set public = true;

drop policy if exists pdfs_public_read on storage.objects;
drop policy if exists pdfs_dm_write on storage.objects;
drop policy if exists pdfs_dm_update on storage.objects;
drop policy if exists pdfs_dm_delete on storage.objects;

create policy pdfs_public_read on storage.objects
  for select using (bucket_id = 'pdfs');
create policy pdfs_dm_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pdfs');
create policy pdfs_dm_update on storage.objects
  for update to authenticated
  using (bucket_id = 'pdfs');
create policy pdfs_dm_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'pdfs');
