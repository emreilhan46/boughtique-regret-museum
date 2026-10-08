-- Run once in Supabase > SQL Editor. Requires a new/empty project.
create extension if not exists pgcrypto;
create table public.exhibits (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(title) between 3 and 130),
 story text not null check(char_length(story) between 20 and 2500),
 lesson text check(lesson is null or char_length(lesson)<=250),
 category text not null check(category in ('Impulse buy','Expensive mistake','Never used','Influenced & regretted','Luxury regret','Tech disappointment','Home & furniture','Car & transport','Other')),
 original_price numeric(12,2) check(original_price between 0 and 999999999),
 currency text not null default 'EUR' check(currency in ('EUR','USD','GBP','CHF','CAD','AUD')),
 for_sale boolean not null default false,
 asking_price numeric(12,2),
 item_condition text check(item_condition in ('new','good','fair','parts')),
 location text check(location is null or char_length(location)<=100),
 photo_paths text[] not null default '{}',
 status text not null default 'published' check(status in ('published','hidden')),
 created_at timestamptz not null default now(),
 constraint sale_requires_details check(not for_sale or (asking_price>0 and item_condition is not null and length(trim(location))>0 and array_length(photo_paths,1) between 1 and 6)),
 constraint photo_limit check(coalesce(array_length(photo_paths,1),0)<=6)
);
create index exhibits_public_feed on public.exhibits(status,created_at desc);
create index exhibits_owner on public.exhibits(user_id);
create table public.conversations (
 id uuid primary key default gen_random_uuid(),
 exhibit_id uuid not null references public.exhibits(id) on delete cascade,
 buyer_id uuid not null references auth.users(id) on delete cascade,
 seller_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(exhibit_id,buyer_id),
 check(buyer_id<>seller_id)
);
create index conversations_buyer on public.conversations(buyer_id);
create index conversations_seller on public.conversations(seller_id);
create table public.messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 sender_id uuid not null references auth.users(id) on delete cascade,
 body text not null check(char_length(trim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index messages_thread on public.messages(conversation_id,created_at);
create table public.reports (
 id uuid primary key default gen_random_uuid(),
 reporter_id uuid not null references auth.users(id) on delete cascade,
 exhibit_id uuid not null references public.exhibits(id) on delete cascade,
 reason text not null check(reason in ('Spam or scam','Prohibited item','Privacy concern','Harassment or abuse','Other')),
 created_at timestamptz not null default now(),
 unique(reporter_id,exhibit_id)
);
-- Enable row level security everywhere.
alter table public.exhibits enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;
create policy "Published exhibits are visible" on public.exhibits for select using (status='published' or auth.uid()=user_id);
create policy "Owners can create published exhibits" on public.exhibits for insert to authenticated with check(auth.uid()=user_id and status='published');
-- Only permit owner to change published sale status from true to false. Other content is immutable in MVP.
create policy "Owners can mark sold" on public.exhibits for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "Conversation participants read" on public.conversations for select to authenticated using(auth.uid()=buyer_id or auth.uid()=seller_id);
-- Conversations created ONLY by vetted SECURITY DEFINER function below.
create policy "Message participants read" on public.messages for select to authenticated using(exists(select 1 from public.conversations c where c.id=conversation_id and auth.uid() in (c.buyer_id,c.seller_id)));
create policy "Participants send their own messages" on public.messages for insert to authenticated with check(sender_id=auth.uid() and exists(select 1 from public.conversations c where c.id=conversation_id and auth.uid() in (c.buyer_id,c.seller_id)));
create policy "Authenticated users report" on public.reports for insert to authenticated with check(reporter_id=auth.uid());
-- Safe server-side conversation creation, never trust seller id from client.
create or replace function public.start_conversation(p_exhibit_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_buyer uuid:=auth.uid(); v_seller uuid; v_id uuid;
begin
 if v_buyer is null then raise exception 'Sign in required'; end if;
 select user_id into v_seller from public.exhibits where id=p_exhibit_id and status='published' and for_sale=true;
 if v_seller is null then raise exception 'Item not available'; end if;
 if v_seller=v_buyer then raise exception 'Cannot message yourself'; end if;
 insert into public.conversations(exhibit_id,buyer_id,seller_id) values(p_exhibit_id,v_buyer,v_seller)
 on conflict(exhibit_id,buyer_id) do update set exhibit_id=excluded.exhibit_id returning id into v_id;
 return v_id;
end $$;
revoke all on function public.start_conversation(uuid) from public;
grant execute on function public.start_conversation(uuid) to authenticated;
-- Public bucket; images are intentionally viewable by everyone once URLs are known.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('exhibit-photos','exhibit-photos',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy "Public photo reading" on storage.objects for select using(bucket_id='exhibit-photos');
create policy "Authenticated users upload own photos" on storage.objects for insert to authenticated
with check(bucket_id='exhibit-photos' and (storage.foldername(name))[1]=auth.uid()::text);
-- A secure, narrow UPDATE policy is needed to avoid owners changing content or impersonating others.
-- Block edits to immutable fields via trigger; allow ONLY sale closure.
create or replace function public.enforce_exhibit_update() returns trigger language plpgsql as $$
begin
 if old.user_id is distinct from new.user_id or old.id is distinct from new.id or old.title is distinct from new.title
 or old.story is distinct from new.story or old.lesson is distinct from new.lesson or old.category is distinct from new.category
 or old.original_price is distinct from new.original_price or old.currency is distinct from new.currency
 or old.asking_price is distinct from new.asking_price or old.item_condition is distinct from new.item_condition
 or old.location is distinct from new.location or old.photo_paths is distinct from new.photo_paths
 or old.status is distinct from new.status or old.created_at is distinct from new.created_at
 or old.for_sale=false or new.for_sale=true then
 raise exception 'Only marking a sale listing as sold is supported';
 end if;
 return new;
end $$;
create trigger exhibit_update_guard before update on public.exhibits for each row execute function public.enforce_exhibit_update();
-- Turn on realtime for messages in Supabase Dashboard > Database > Publications > supabase_realtime if desired.
