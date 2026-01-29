import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import { useAuth } from './authContext';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData, char => char.charCodeAt(0));
}

interface UsePushNotificationsOptions {
  playerAccountId?: string;
}

export function usePushNotifications(options?: UsePushNotificationsOptions) {
  const { user } = useAuth();
  const playerAccountId = options?.playerAccountId;
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supported = 'serviceWorker' in navigator &&
                      'PushManager' in window &&
                      'Notification' in window &&
                      !!VAPID_PUBLIC_KEY;
    setIsSupported(supported);

    if ('Notification' in window) {
      setPermission(Notification.permission);
    }

    if (supported && (user || playerAccountId)) {
      checkSubscription();
    }
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

  const subscribe = useCallback(async () => {
    if ((!user && !playerAccountId) || !isSupported) return false;

    setLoading(true);
    try {
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);

      if (permissionResult !== 'granted') {
        return false;
      }

      const registration = await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
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
      return true;
    } catch (error) {
      console.error('Error subscribing to push:', error);
      return false;
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
    subscribe,
    unsubscribe,
  };
}
