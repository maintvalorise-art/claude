-- =====================================================================
-- Gestion des comptes depuis l'application, sans Edge Function :
-- création (identifiant sans e-mail), mot de passe, activation.
-- Réservé aux administrateurs. Script sans risque, relançable.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- Identifiant simple « ahmed » → e-mail technique « ahmed@flotte.local ».
create or replace function public.admin_creer_compte(
  p_username text, p_password text, p_full_name text, p_role text,
  p_phone text default null, p_service text default null,
  p_manager_id uuid default null, p_demandeur_autorise boolean default false)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(trim(coalesce(p_username, '')));
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux administrateurs';
  end if;
  if v_email !~ '^[a-z0-9._@-]{3,}$' then
    raise exception 'Identifiant invalide (3 caractères min., lettres/chiffres/._-)';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Mot de passe : 6 caractères minimum';
  end if;
  if p_role not in ('admin', 'direction', 'acheteur', 'magasinier', 'responsable_flotte', 'exploitation', 'chauffeur', 'demandeur') then
    raise exception 'Profil invalide : %', p_role;
  end if;
  if position('@' in v_email) = 0 then
    v_email := v_email || '@flotte.local';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Cet identifiant existe déjà : %', split_part(v_email, '@', 1);
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          crypt(p_password, gen_salt('bf')), now(),
          '{"provider": "email", "providers": ["email"]}'::jsonb,
          jsonb_build_object('full_name', coalesce(nullif(trim(p_full_name), ''), split_part(v_email, '@', 1))),
          now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  -- Le profil est créé par le déclencheur on_auth_user_created ; on le complète.
  update public.profiles
     set full_name = coalesce(nullif(trim(p_full_name), ''), username),
         role = p_role,
         phone = nullif(trim(p_phone), ''),
         service = nullif(trim(p_service), ''),
         manager_id = p_manager_id,
         demandeur_autorise = coalesce(p_demandeur_autorise, false)
   where id = v_id;
  return v_id;
end;
$$;

create or replace function public.admin_mot_de_passe(p_user_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux administrateurs';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Mot de passe : 6 caractères minimum';
  end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user_id;
  if not found then raise exception 'Compte introuvable'; end if;
end;
$$;

-- Désactiver bloque la connexion sans supprimer le compte ni son historique.
create or replace function public.admin_activer_compte(p_user_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux administrateurs';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Impossible de désactiver votre propre compte';
  end if;
  update auth.users set banned_until = case when p_active then null else now() + interval '100 years' end, updated_at = now()
   where id = p_user_id;
  update public.profiles set active = p_active where id = p_user_id;
end;
$$;

revoke all on function public.admin_creer_compte(text, text, text, text, text, text, uuid, boolean) from public, anon;
revoke all on function public.admin_mot_de_passe(uuid, text) from public, anon;
revoke all on function public.admin_activer_compte(uuid, boolean) from public, anon;
grant execute on function public.admin_creer_compte(text, text, text, text, text, text, uuid, boolean) to authenticated;
grant execute on function public.admin_mot_de_passe(uuid, text) to authenticated;
grant execute on function public.admin_activer_compte(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
