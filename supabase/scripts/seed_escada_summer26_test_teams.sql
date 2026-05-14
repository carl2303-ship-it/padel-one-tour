-- Equipas de teste para o torneio escada "Summer 26" (nome aproximado no título).
-- Executar no Supabase: SQL Editor (usa postgres → ignora RLS).
--
-- O que faz:
-- 1) Encontra o torneio mais recente com format = 'ladder' e nome que sugira escada + summer/verão + 26/2026.
-- 2) Remove equipas/jogadores de teste anteriores deste torneio (prefixo [TEST S26]).
-- 3) Para cada categoria do torneio, insere 6 duplas de teste (12 jogadores por categoria).
--
-- Ajuste manual: substitui o SELECT por um id fixo se tiveres vários torneios parecidos:
--   v_tid := '00000000-0000-0000-0000-000000000000'::uuid;

DO $$
DECLARE
  v_tid uuid;
  v_tname text;
  v_cat record;
  v_i int;
  v_p1 uuid;
  v_p2 uuid;
  v_email1 text;
  v_email2 text;
BEGIN
  SELECT t.id, t.name
  INTO v_tid, v_tname
  FROM tournaments t
  WHERE t.format = 'ladder'
    AND lower(t.name) LIKE '%escada%'
    AND (
      lower(t.name) LIKE '%summer%'
      OR lower(t.name) LIKE '%verão%'
      OR lower(t.name) LIKE '%verao%'
    )
    AND (
      lower(t.name) LIKE '%26%'
      OR lower(t.name) LIKE '%2026%'
    )
  ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC
  LIMIT 1;

  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'Nenhum torneio escada "Summer 26" encontrado. Verifica o nome no painel ou edita o filtro no topo deste script.';
  END IF;

  RAISE NOTICE 'Torneio alvo: % (id=%)', v_tname, v_tid;

  DELETE FROM teams t
  WHERE t.tournament_id = v_tid
    AND t.name LIKE '[TEST S26]%';

  DELETE FROM players p
  WHERE p.tournament_id = v_tid
    AND (p.name LIKE '[TEST S26]%' OR p.email LIKE 'test-s26-%@example.invalid');

  FOR v_cat IN
    SELECT tc.id, tc.name
    FROM tournament_categories tc
    WHERE tc.tournament_id = v_tid
    ORDER BY tc.name
  LOOP
    FOR v_i IN 1..6 LOOP
      v_email1 := format('test-s26-%s-%s-j1-%s@example.invalid', replace(v_cat.id::text, '-', ''), v_i, replace(gen_random_uuid()::text, '-', ''));
      v_email2 := format('test-s26-%s-%s-j2-%s@example.invalid', replace(v_cat.id::text, '-', ''), v_i, replace(gen_random_uuid()::text, '-', ''));

      INSERT INTO players (name, email, tournament_id, category_id, payment_status)
      VALUES (
        format('[TEST S26] %s E%s J1', v_cat.name, v_i),
        v_email1,
        v_tid,
        v_cat.id,
        'exempt'
      )
      RETURNING id INTO v_p1;

      INSERT INTO players (name, email, tournament_id, category_id, payment_status)
      VALUES (
        format('[TEST S26] %s E%s J2', v_cat.name, v_i),
        v_email2,
        v_tid,
        v_cat.id,
        'exempt'
      )
      RETURNING id INTO v_p2;

      INSERT INTO teams (tournament_id, category_id, name, player1_id, player2_id, seed)
      VALUES (
        v_tid,
        v_cat.id,
        format('[TEST S26] %s — Equipa %s', v_cat.name, v_i),
        v_p1,
        v_p2,
        v_i
      );
    END LOOP;

    RAISE NOTICE 'Categoria "%": 6 equipas de teste criadas.', v_cat.name;
  END LOOP;

  RAISE NOTICE 'Concluído. Na UI da escada, usa "Sincronizar novas equipas" se a escada já estiver publicada com positions fixas.';
END $$;
