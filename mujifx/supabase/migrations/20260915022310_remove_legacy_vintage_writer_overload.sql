drop function if exists public.save_indicator_observation_vintage(text,date,numeric,boolean,date,timestamptz,text,text,text);

revoke all on function public.save_indicator_observation_vintage(text,date,numeric,boolean,date,timestamptz,text,text,text,text) from public, anon, authenticated;
grant execute on function public.save_indicator_observation_vintage(text,date,numeric,boolean,date,timestamptz,text,text,text,text) to service_role;
