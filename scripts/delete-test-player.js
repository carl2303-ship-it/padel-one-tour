// Script para eliminar jogador TEST
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rqiwnxcexsccguruiteq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3Njc5MzcsImV4cCI6MjA3NTM0MzkzN30.Dl05zPQDtPVpmvn_Y-JokT3wDq0Oh9uF3op5xcHZpkY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function deleteTestPlayer() {
  const tournamentId = '8bdc3e84-2367-48eb-80f2-d3b8e6cd9121';
  
  // Encontrar o jogador TEST
  const { data: testPlayers, error: findError } = await supabase
    .from('players')
    .select('id, name, tournament_id')
    .eq('tournament_id', tournamentId)
    .ilike('name', '%test%');

  if (findError) {
    console.error('Erro ao procurar:', findError);
    return;
  }

  console.log('Jogadores TEST encontrados:', testPlayers);

  if (!testPlayers || testPlayers.length === 0) {
    console.log('Nenhum jogador TEST encontrado');
    return;
  }

  for (const player of testPlayers) {
    console.log(`Eliminando: ${player.name} (ID: ${player.id})`);
    
    const { error: deleteError } = await supabase
      .from('players')
      .delete()
      .eq('id', player.id);

    if (deleteError) {
      console.error(`Erro ao eliminar ${player.name}:`, deleteError);
    } else {
      console.log(`✓ ${player.name} eliminado com sucesso`);
    }
  }
}

deleteTestPlayer();
