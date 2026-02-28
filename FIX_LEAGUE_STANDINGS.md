# Fix: Jogadores com categoria não aparecem nas ligas

## Problema
Jogadores atribuídos a uma categoria depois do torneio estar completo não aparecem na classificação das ligas.

## Solução

### 1. Aplicar a Migration SQL

A migration `20260227000000_fix_league_standings_filter_by_category.sql` precisa de ser aplicada no Supabase:

```bash
# Via CLI
supabase db push

# Ou aplicar manualmente no Dashboard do Supabase:
# SQL Editor > New Query > Colar o conteúdo da migration > Run
```

### 2. Verificar se os jogadores têm final_position

Os jogadores precisam de ter `final_position` definido para aparecerem nas ligas. Se atribuíres uma categoria a um jogador depois do torneio estar completo, pode ser necessário recalcular as posições finais.

### 3. Recalcular as ligas

Após atribuir categorias aos jogadores, deves:

1. **Recalcular posições finais** para a categoria:
   - No código, chama `calculateIndividualFinalPositions(tournamentId, categoryId)`

2. **Recalcular as ligas**:
   - Chama `updateLeagueStandings(tournamentId)`

### 4. Função de diagnóstico

Use a função `diagnoseLeagueStandingsIssue(tournamentId, leagueId)` no console do browser para verificar:
- Quantos jogadores têm categoria
- Quantos têm `final_position`
- Quantos aparecem nas standings

### Exemplo de uso no console:

```javascript
import { diagnoseLeagueStandingsIssue, recalculateLeagueStandingsForCategory } from './lib/leagueStandings';

// Diagnosticar
const result = await diagnoseLeagueStandingsIssue('tournament-id', 'league-id');
console.log(result);

// Recalcular para uma categoria
await recalculateLeagueStandingsForCategory('tournament-id', 'category-id');
```

## Verificação

Após aplicar a migration e recalcular:

1. Verifica no Supabase SQL Editor:
```sql
-- Ver jogadores com categoria mas sem final_position
SELECT id, name, category_id, final_position 
FROM players 
WHERE tournament_id = 'seu-tournament-id' 
AND category_id IS NOT NULL 
AND final_position IS NULL;

-- Ver standings da liga
SELECT * FROM league_standings 
WHERE league_id = 'seu-league-id';
```

2. Se houver jogadores sem `final_position`, recalcula as posições finais para essa categoria.
