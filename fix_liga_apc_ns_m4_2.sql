-- Corrigir classificação do torneio LIGA APC N-S M4-2
-- Critérios aplicados: 1.Vitórias 2.Pontos (V=2,E=1,D=0) 3.Confronto direto 4.+/- 5.Jogos 6.Inscrição
-- Executar no Supabase SQL Editor: https://supabase.com/dashboard/project/rqiwnxcexsccguruiteq/sql

UPDATE teams SET final_position = 1 WHERE id = '53df5a3a-1495-4c1f-8043-05ec89792b9b';  -- Antonio - Jordi
UPDATE teams SET final_position = 2 WHERE id = 'ce95dc50-a9cf-4be0-80ee-f3919f19c7c5';  -- David - Rui
UPDATE teams SET final_position = 3 WHERE id = '64be17ca-1463-40e5-bebe-a8261361c8b7';  -- Paulo's
UPDATE teams SET final_position = 4 WHERE id = '24268fb0-339c-4311-99b8-7f229c9faee4';  -- David - João
UPDATE teams SET final_position = 5 WHERE id = '3a194149-2f45-47a0-a684-0bf7df04c084';  -- Imagine rabbit
UPDATE teams SET final_position = 6 WHERE id = '9d99794a-d280-4046-8130-173ad48df6b7';  -- Be Brave
