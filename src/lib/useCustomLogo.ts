import { useState, useEffect, useContext } from 'react';
import { supabase } from './supabase';
import { AuthContext } from './authContext';
import { getBrandLogoUrl } from './organizationTheme';

export function useCustomLogo(userId?: string) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const authContext = useContext(AuthContext);
  const user = authContext?.user;

  const targetUserId = userId || user?.id;

  useEffect(() => {
    loadLogo();
  }, [targetUserId]);

  const loadLogo = async () => {
    if (!targetUserId) {
      setLoading(false);
      return;
    }

    try {
      const { data } = await supabase
        .from('user_logo_settings')
        .select('logo_url')
        .eq('user_id', targetUserId)
        .maybeSingle();

      if (data?.logo_url) {
        setLogoUrl(data.logo_url);
      }
    } catch (error) {
      console.error('Error loading custom logo:', error);
    } finally {
      setLoading(false);
    }
  };

  const defaultLogoUrl = getBrandLogoUrl();

  return {
    logoUrl: logoUrl || defaultLogoUrl,
    hasCustomLogo: !!logoUrl,
    loading,
  };
}
