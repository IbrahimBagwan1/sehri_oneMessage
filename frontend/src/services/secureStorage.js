import * as SecureStore from 'expo-secure-store';

/**
 * secureStorage.js — every SecureStore read and write in the app goes
 * through here, so they all use the same Keychain accessibility.
 *
 * WHY
 * SecureStore defaults to WHEN_UNLOCKED: on iOS the Keychain item cannot be
 * read while the phone is locked. The rider's GPS feed runs as a background
 * task with the screen off — the whole point of it — so with the default,
 * every location push after the phone locked failed to read the rider's
 * token, and a token refreshed mid-run could not be written back. Tracking
 * stopped the moment the rider put the phone in their pocket.
 *
 * AFTER_FIRST_UNLOCK keeps items encrypted at rest and unreadable after a
 * reboot until the owner unlocks the phone once, but lets a background task
 * read them while the screen is locked. It is Apple's recommended level for
 * data a background task needs. (Android is unaffected: the keystore has no
 * lock-state gate.)
 *
 * MIGRATION
 * iOS keeps an item's original accessibility when it is updated in place,
 * so items written before this change stay WHEN_UNLOCKED until deleted and
 * re-written. migrateKeychainAccessibility() does that once, at launch,
 * while the app is in the foreground (and therefore unlocked).
 */

const OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

const MIGRATED_FLAG = 'keychain_after_first_unlock_v1';

// Everything the app keeps in SecureStore.
const KEYS = [
  'access_token', 'refresh_token', 'user_data', 'active_role', 'available_roles', 'is_guest',
  'rider_access_token', 'rider_refresh_token', 'rider_data', 'rider_round_started_at',
];

export const getSecure = (key) => SecureStore.getItemAsync(key, OPTIONS);
export const setSecure = (key, value) => SecureStore.setItemAsync(key, value, OPTIONS);
export const deleteSecure = (key) => SecureStore.deleteItemAsync(key, OPTIONS);

let migration = null;

/** Re-write existing items with the new accessibility. Idempotent; runs once. */
export const migrateKeychainAccessibility = () => {
  if (migration) return migration;
  migration = (async () => {
    try {
      if (await getSecure(MIGRATED_FLAG)) return;
      for (const key of KEYS) {
        const value = await getSecure(key);
        if (value == null) continue;
        // Delete first: an in-place update keeps the old accessibility.
        await deleteSecure(key);
        await setSecure(key, value);
      }
      await setSecure(MIGRATED_FLAG, '1');
    } catch {
      // Never block startup on this; it retries on the next launch.
      migration = null;
    }
  })();
  return migration;
};
