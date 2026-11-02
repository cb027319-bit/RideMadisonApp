-- Allow events imported from SeatGeek (events-sync, when the SEATGEEK_CLIENT_ID secret is set).
alter table public.events drop constraint if exists events_source_check;
alter table public.events
  add constraint events_source_check
  check (source in ('curated', 'partner', 'ticketmaster', 'seatgeek'));
