alter table public.public_data_restaurants
  add column if not exists image_source text,
  add column if not exists image_attribution text,
  add column if not exists image_source_url text,
  add column if not exists image_checked_at timestamptz;

create index if not exists public_data_restaurants_image_source_idx
  on public.public_data_restaurants(image_source);
