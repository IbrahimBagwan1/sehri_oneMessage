import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { onNotificationTap, getInitialNotification } from '../services/pushService';

/**
 * useNotificationRouting — makes tapping a notification go somewhere.
 *
 * pushService has exported `onNotificationTap` since the first version of
 * this feature, but nothing ever called it, so every notification opened the
 * app on whatever screen it was last on. This hook is the missing half.
 *
 * Two arrival paths, and they are genuinely different:
 *   • app already running (foreground or backgrounded) → the listener fires
 *   • app was killed and the tap launched it → no listener exists yet, so
 *     the payload has to be read once from the launch response instead
 * Miss the second and notifications appear to "work" in testing and do
 * nothing for a user whose phone killed the app overnight — which is most
 * of them, for a Sehri app that notifies before dawn.
 *
 * Route comes from the notification's own `data.route`, set by the backend
 * trigger that sent it, with a `type` fallback so an older payload (already
 * delivered, sitting in someone's tray) still lands somewhere sensible
 * rather than nowhere.
 */

const ROUTE_FOR_TYPE = {
  poll_open:        '/(user)',
  ayat_of_the_day:  '/(user)',
  broadcast:        '/(user)',
  delivery_started: '/(user)/track',
  delivery_arrival: '/(user)/track',
};

const resolveRoute = (data) => {
  if (!data) return null;
  if (typeof data.route === 'string' && data.route.startsWith('/')) return data.route;
  return ROUTE_FOR_TYPE[data.type] || null;
};

export default function useNotificationRouting() {
  const router = useRouter();
  // Held in a ref so the subscribe effect below can stay dependency-free and
  // register exactly one listener for the app's lifetime. Assigned in an
  // effect rather than during render, which React forbids.
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; });

  useEffect(() => {
    let cancelled = false;

    // Cold start: the tap that launched the app.
    getInitialNotification().then((data) => {
      if (cancelled) return;
      const route = resolveRoute(data);
      // Pushed, not replaced, so the back gesture still reaches the tab the
      // app would otherwise have opened on.
      if (route) routerRef.current.push(route);
    });

    // Warm taps for as long as the app lives.
    const unsubscribe = onNotificationTap((data) => {
      const route = resolveRoute(data);
      if (route) routerRef.current.push(route);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
}
