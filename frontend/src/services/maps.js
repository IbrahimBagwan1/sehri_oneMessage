import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * maps.js — is a Google Maps key built into this app?
 *
 * The map screens use Google Maps (PROVIDER_GOOGLE). Without a key the
 * native SDK does not show an empty map — it throws "API key not found" and
 * takes the whole app down the moment a map is mounted. Release builds
 * cannot be made without a key (app.config.js refuses), but a development
 * build made from a .env without GOOGLE_MAPS_ANDROID_API_KEY /
 * GOOGLE_MAPS_IOS_API_KEY can. Screens check this before mounting a map and
 * show MapUnavailable instead.
 *
 * Sources, in order:
 *   1. extra.googleMaps — booleans app.config.js records (never the key).
 *      Present in release builds and in any dev server started after it
 *      was added.
 *   2. The platform's map config (android.config.googleMaps.apiKey /
 *      ios.config.googleMapsApiKey). Development servers include it;
 *      release builds strip it, which is why (1) exists.
 *   3. Neither present (an older build): assume the key is there, which is
 *      how those builds behaved.
 */
const config = Constants.expoConfig;
const flags = config?.extra?.googleMaps;
const platformKey = Platform.OS === 'ios'
  ? config?.ios?.config?.googleMapsApiKey
  : config?.android?.config?.googleMaps?.apiKey;

export const googleMapsAvailable = flags
  ? Boolean(flags[Platform.OS])
  : platformKey !== undefined ? Boolean(platformKey) : true;
