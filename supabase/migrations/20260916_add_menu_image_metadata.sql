alter table public.public_data_menus
  add column if not exists image_url text,
  add column if not exists image_source text,
  add column if not exists image_source_url text,
  add column if not exists image_attribution text,
  add column if not exists image_checked_at timestamptz,
  add column if not exists image_status text not null default 'unchecked';

alter table public.public_data_menus
  drop constraint if exists public_data_menus_image_status_check;

alter table public.public_data_menus
  add constraint public_data_menus_image_status_check
  check (image_status in ('unchecked', 'verified', 'not_available', 'needs_review'));

create index if not exists public_data_menus_image_status_idx
  on public.public_data_menus(image_status);
