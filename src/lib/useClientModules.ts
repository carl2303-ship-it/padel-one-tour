import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

export type ModuleCode = 'tournaments' | 'manager' | 'bar' | 'ai_full' | 'ai_light';
export type PlayerAppMode = 'lite' | 'full';
export type EntityType = 'club' | 'organizer';

export interface ClientModulesResult {
  modules: ModuleCode[];
  playerMode: PlayerAppMode;
  hasManager: boolean;
  hasTournaments: boolean;
  hasBar: boolean;
  hasAiFull: boolean;
  hasAiLight: boolean;
}

const EMPTY: ClientModulesResult = {
  modules: [],
  playerMode: 'full',
  hasManager: false,
  hasTournaments: false,
  hasBar: false,
  hasAiFull: false,
  hasAiLight: false,
};

function parseModules(data: unknown): ClientModulesResult {
  if (!data || typeof data !== 'object') return EMPTY;
  const obj = data as Record<string, unknown>;
  const modules = Array.isArray(obj.modules) ? (obj.modules as ModuleCode[]) : [];
  return {
    modules,
    playerMode: (obj.player_mode as PlayerAppMode) || 'full',
    hasManager: !!obj.has_manager,
    hasTournaments: !!obj.has_tournaments,
    hasBar: !!obj.has_bar,
    hasAiFull: !!obj.has_ai_full,
    hasAiLight: !!obj.has_ai_light,
  };
}

export function useClientModules(entityType: EntityType | null, entityId: string | null) {
  const [result, setResult] = useState<ClientModulesResult>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!entityType || !entityId) {
      setResult(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc('get_client_modules', {
      p_entity_type: entityType,
      p_entity_id: entityId,
    });
    if (!error && data) {
      setResult(parseModules(data));
    } else {
      setResult(EMPTY);
    }
    setLoading(false);
  }, [entityType, entityId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hasModule = useCallback(
    (code: ModuleCode) => result.modules.includes(code),
    [result.modules]
  );

  return { ...result, loading, refresh, hasModule };
}

export async function fetchClientModules(
  entityType: EntityType,
  entityId: string
): Promise<ClientModulesResult> {
  const { data, error } = await supabase.rpc('get_client_modules', {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  if (error || !data) return EMPTY;
  return parseModules(data);
}
