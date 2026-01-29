import { useState, useEffect, useContext } from 'react';
import { supabase } from './supabase';
import { AuthContext } from './authContext';

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

  // URL padrão do logo BoostPadel no Supabase Storage
  const defaultLogoUrl = 'https://rqiwnxcexsccguruiteq.supabase.co/storage/v1/object/sign/Logos/Boostpadel-logo.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV81OWQyMTAwNy1kOWY2LTQwZjktYWY4NC02MDBlZDJkZGQ0MTkiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJMb2dvcy9Cb29zdHBhZGVsLWxvZ28ucG5nIiwiaWF0IjoxNzY5NjAzMDg5LCJleHAiOjIwODQ5NjMwODl9.NZ_fLlxEIFXTHM3PyKW-UJa-YF32fdVTqkLJrbGXhg0';

  return {
    logoUrl: logoUrl || defaultLogoUrl,
    hasCustomLogo: !!logoUrl,
    loading,
  };
}
