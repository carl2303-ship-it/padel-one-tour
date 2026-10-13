import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import { useAuth } from './authContext';

// Same VAPID public key used across all Padel One apps
const VAPID_PUBLIC_KEY = 'BET_2Ji1WCUYQHQEzqyUiOzpKsmfQn9LuPTbNemOY0pxOiO4wbwpMYIfRcAMdJncZmo7vBDggAcih1IIxSdGi58';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData, char => char.charCodeAt(0));
}

interface UsePushNotificationsOptions {
  playerAccountId?: string;
}

function pushSubscribeErrorMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: string }).name) : '';
  const raw =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message: string }).message)
        : String(error || '');
  const msg = raw.toLowerCase();

  if (
    name === 'AbortError' ||
    msg.includes('push service not available') ||
    msg.includes('registration failed')
  ) {
    return (
      'O serviço de push do browser não está disponível neste dispositivo. ' +
      'No Windows: Definições → Sistema → Notificações → ative as notificações. ' +
      'Use Chrome/Edge (não modo convidado), desative VPN/bloqueadores e tente novamente.'
    );
  }
  if (msg.includes('permission') || msg.includes('denied')) {
    return 'Permissão negada. Ative as notificações nas definições do browser para este site.';
  }
  if (msg.includes('service worker')) {
    return 'Service Worker indisponível. Recarregue a página (ou limpe a cache do site) e tente outra vez.';
  }
  return raw || 'Erro ao ativar notificações';
}

export function usePushNotifications(options?: UsePushNotificationsOptions) {
  const { user } = useAuth();
  const playerAccountId = options?.playerAccountId;
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    const checkSupport = async () => {
      const hasServiceWorker = 'serviceWorker' in navigator;
      const hasPushManager = 'PushManager' in window;
      const hasNotification = 'Notification' in window;
      const hasVapidKey = !!VAPID_PUBLIC_KEY;
      
      const supported = hasServiceWorker && hasPushManager && hasNotification && hasVapidKey;
      setIsSupported(supported);

      if ('Notification' in window) {
        setPermission(Notification.permission);
      }

      // Wait for service worker to be ready before checking subscription
      if (supported && (user || playerAccountId)) {
        try {
          // Wait for service worker registration to be ready
          if ('serviceWorker' in navigator) {
            await navigator.serviceWorker.ready;
          }
          checkSubscription();
        } catch (error) {
          console.error('[PushNotifications] Error waiting for service worker:', error);
          // Still try to check subscription even if service worker isn't ready
          checkSubscription();
        }
      }
    };

    checkSupport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, playerAccountId]);

  const checkSubscription = async () => {
    if (!user && !playerAccountId) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        let query = supabase
          .from('push_subscriptions')
          .select('id')
          .eq('endpoint', subscription.endpoint);

        if (playerAccountId) {
          query = query.eq('player_account_id', playerAccountId);
        } else if (user) {
          query = query.eq('user_id', user.id);
        }

        const { data } = await query.maybeSingle();
        setIsSubscribed(!!data);
      } else {
        setIsSubscribed(false);
      }
    } catch (error) {
      console.error('Error checking subscription:', error);
      setIsSubscribed(false);
    }
  };

  const subscribe = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if ((!user && !playerAccountId) || !isSupported) {
      return { ok: false, error: 'Notificações push não estão disponíveis neste browser.' };
    }

    setLoading(true);
    setLastError(null);
    try {
      if (!window.isSecureContext) {
        throw new Error('As notificações push só funcionam em HTTPS (ou localhost).');
      }

      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);

      if (permissionResult !== 'granted') {
        const err =
          'Permissão negada. Ative as notificações nas definições do browser para este site.';
        setLastError(err);
        return { ok: false, error: err };
      }

      const registration = await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        const keyBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // Some browsers require ArrayBuffer, not Uint8Array view
          applicationServerKey: keyBytes.buffer.slice(
            keyBytes.byteOffset,
            keyBytes.byteOffset + keyBytes.byteLength
          ) as ArrayBuffer,
        });
      }

      const subscriptionJson = subscription.toJSON();

      if (!subscriptionJson.keys?.p256dh || !subscriptionJson.keys?.auth) {
        throw new Error('Invalid subscription keys');
      }

      const insertData: Record<string, string> = {
        endpoint: subscription.endpoint,
        p256dh: subscriptionJson.keys.p256dh,
        auth: subscriptionJson.keys.auth,
        updated_at: new Date().toISOString(),
        app_source: 'tour',
      };

      if (playerAccountId) {
        insertData.player_account_id = playerAccountId;
      } else if (user) {
        insertData.user_id = user.id;
      }

      const { error } = await supabase
        .from('push_subscriptions')
        .upsert(insertData, {
          onConflict: playerAccountId ? 'player_account_id,endpoint' : 'user_id,endpoint',
          ignoreDuplicates: false,
        });

      if (error) throw error;

      setIsSubscribed(true);
      return { ok: true };
    } catch (error) {
      console.error('Error subscribing to push:', error);
      const err = pushSubscribeErrorMessage(error);
      setLastError(err);
      return { ok: false, error: err };
    } finally {
      setLoading(false);
    }
  }, [user, playerAccountId, isSupported]);

  const unsubscribe = useCallback(async () => {
    if (!user && !playerAccountId) return false;

    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();

        let query = supabase
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', subscription.endpoint);

        if (playerAccountId) {
          query = query.eq('player_account_id', playerAccountId);
        } else if (user) {
          query = query.eq('user_id', user.id);
        }

        await query;
      }

      setIsSubscribed(false);
      return true;
    } catch (error) {
      console.error('Error unsubscribing from push:', error);
      return false;
    } finally {
      setLoading(false);
    }
  }, [user, playerAccountId]);

  return {
    permission,
    isSubscribed,
    isSupported,
    loading,
    lastError,
    subscribe,
    unsubscribe,
  };
}
