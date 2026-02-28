# Diagnóstico: Jogadoras em falta na Liga

## Problema
- 12 jogadoras F6
- 19 jogadoras F5
- 5 jogadoras F4
**Total: 36 jogadoras**
**Na liga: 25 jogadoras**
**Faltam: 11 jogadoras**

## Queries de diagnóstico

### 1. Verificar configuração da liga e categorias
```sql
-- Ver todas as ligas e suas categorias
SELECT 
  l.id as league_id,
  l.name as league_name,
  tl.tournament_id,
  tl.league_category,
  t.name as tournament_name,
  t.status as tournament_status
FROM tournament_leagues tl
JOIN leagues l ON l.id = tl.league_id
JOIN tournaments t ON t.id = tl.tournament_id
WHERE l.name LIKE '%F4%F5%F6%' OR l.name LIKE '%F4-F5%F6%'
ORDER BY l.name, t.name;
```

### 2. Verificar jogadoras por categoria em todos os torneios
```sql
-- Ver jogadoras por categoria em torneios completados
SELECT 
  tc.name as category_name,
  COUNT(DISTINCT p.id) as total_players,
  COUNT(DISTINCT CASE WHEN p.final_position IS NOT NULL THEN p.id END) as players_with_position
FROM tournament_categories tc
LEFT JOIN players p ON p.category_id = tc.id
LEFT JOIN tournaments t ON t.id = p.tournament_id
WHERE t.status = 'completed'
  AND (tc.name LIKE '%F4%' OR tc.name LIKE '%F5%' OR tc.name LIKE '%F6%')
GROUP BY tc.id, tc.name
ORDER BY tc.name;
```

### 3. Verificar jogadoras sem final_position
```sql
-- Jogadoras sem final_position em torneios completados
SELECT 
  p.id,
  p.name,
  p.category_id,
  tc.name as category_name,
  p.final_position,
  t.id as tournament_id,
  t.name as tournament_name
FROM players p
LEFT JOIN tournament_categories tc ON tc.id = p.category_id
LEFT JOIN tournaments t ON t.id = p.tournament_id
WHERE t.status = 'completed'
  AND (tc.name LIKE '%F4%' OR tc.name LIKE '%F5%' OR tc.name LIKE '%F6%')
  AND p.final_position IS NULL
ORDER BY tc.name, p.name;
```

### 4. Verificar standings atuais da liga
```sql
-- Ver standings atuais
SELECT 
  ls.entity_name,
  ls.total_points,
  ls.tournaments_played,
  ls.best_position,
  ls.player_account_id
FROM league_standings ls
JOIN leagues l ON l.id = ls.league_id
WHERE l.name LIKE '%F4%F5%F6%' OR l.name LIKE '%F4-F5%F6%'
ORDER BY ls.total_points DESC;
```

### 5. Verificar se há múltiplas league_category para o mesmo torneio
```sql
-- Ver se um torneio tem múltiplas league_category
SELECT 
  tournament_id,
  COUNT(DISTINCT league_category) as num_categories,
  STRING_AGG(DISTINCT league_category, ', ') as categories
FROM tournament_leagues
GROUP BY tournament_id
HAVING COUNT(DISTINCT league_category) > 1;
```

## Possíveis causas

1. **Jogadoras sem `final_position`**: Se algumas jogadoras não têm `final_position`, não aparecem na liga
2. **Jogadoras sem `category_id`**: Se algumas jogadoras não têm `category_id` atribuído, não são filtradas corretamente
3. **Liga com múltiplas categorias**: Se a liga tem `league_category` = "F4-F5" e outra entrada com "F6", a função pode não estar a processar ambas
4. **Torneios não finalizados**: Se alguns torneios não estão `completed`, as jogadoras não aparecem
5. **Filtro de categoria incorreto**: A função pode estar a filtrar incorretamente quando há múltiplas categorias

## Solução

Se a liga tem múltiplas `league_category` (ex: "F4-F5" e "F6"), a função SQL precisa de processar ambas. A função atual processa cada `league_category` separadamente, mas pode haver um problema se:
- Um torneio tem categoria "F4-F5" mas a liga espera "F4" e "F5" separadamente
- A liga tem uma entrada para "F4-F5" e outra para "F6", mas os torneios não estão configurados corretamente
