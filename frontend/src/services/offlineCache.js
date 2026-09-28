import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * offlineCache.js — network first, last good copy when the network fails.
 *
 * Prayer times, the verse of the day, and Qur'an and Dua content are the
 * things a member most wants when their signal is poor — before dawn, in a
 * masjid basement — and they change rarely or on a schedule. Each fetch
 * stores its successful response; if a later fetch fails for lack of
 * network (not because the server said no), the stored copy is returned
 * instead, marked `offline: { savedAt }` so a screen can say it is a saved
 * copy. Everything else about the response is identical, so screens work
 * offline without special handling.
 *
 * Not for anything personal or security-relevant: this is plain storage.
 */

const PREFIX = 'offline-cache:v1:';

/** A failure that a saved copy can stand in for: no response at all, or a timeout. */
export const isNetworkFailure = (err) => !err?.response || err?.code === 'ECONNABORTED';

/**
 * @param {string} key         cache key
 * @param {() => Promise<object>} fetcher  returns the API envelope ({ success, data, ... })
 * @param {object} [opts]
 * @param {(saved: object) => boolean} [opts.usable]  reject a stale copy (e.g. yesterday's prayer times)
 */
export const networkFirst = async (key, fetcher, { usable } = {}) => {
  try {
    const fresh = await fetcher();
    if (fresh?.success) {
      AsyncStorage.setItem(PREFIX + key, JSON.stringify({ savedAt: Date.now(), body: fresh })).catch(() => {});
    }
    return fresh;
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    let saved = null;
    try {
      const raw = await AsyncStorage.getItem(PREFIX + key);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      saved = null;
    }
    if (!saved?.body || (usable && !usable(saved.body))) throw err;
    return { ...saved.body, offline: { savedAt: saved.savedAt } };
  }
};

/** Forget every cached response (e.g. on sign-out, for tidiness). */
export const clearOfflineCache = async () => {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch { /* nothing to clear */ }
};
