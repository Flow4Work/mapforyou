alter table public.public_data_restaurants
  add column if not exists image_gallery_urls text[] not null default '{}';
