-- Run in the SQL Editor if this project already applied schema.sql before map maker shipped.
alter table public.maps add column if not exists blocked_cells jsonb not null default '[]'::jsonb;
