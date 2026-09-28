/**
 * app.config.js — the app's native configuration, replacing app.json.
 *
 * WHY A .js CONFIG
 * Three values must not live in the repository or must differ per build:
 *   • the Google Maps SDK keys (restricted per platform in Google Cloud,
 *     supplied as EAS environment variables),
 *   • the bundle identifier (permanent once published — see below),
 *   • the EAS project id (needed to mint Expo push tokens in real builds).
 * All three are read from the environment. eas.json sets them per build
 * profile; for local development they come from frontend/.env.
 *
 * THE BUNDLE IDENTIFIER IS FOREVER
 * The store listing is tied to it. A production build refuses to start
 * with the development placeholder, so it cannot be shipped by accident.
 */

const { withInfoPlist } = require('expo/config-plugins');

const IS_PRODUCTION_BUILD = process.env.EAS_BUILD_PROFILE === 'production';

/**
 * expo-task-manager adds the iOS "fetch" background mode unconditionally.
 * The app's only background task is the rider's location feed, which runs
 * under the "location" mode; declaring background fetch without using it is
 * the kind of unexplained capability App Review asks about. Listed FIRST in
 * `plugins` because Info.plist mods run in reverse order, so this one runs
 * after task-manager's has added the entry.
 */
const withoutBackgroundFetch = (config) => withInfoPlist(config, (cfg) => {
  const modes = cfg.modResults.UIBackgroundModes;
  if (Array.isArray(modes)) cfg.modResults.UIBackgroundModes = modes.filter((m) => m !== 'fetch');
  return cfg;
});
const DEV_BUNDLE_ID = 'com.anonymous.onemessage';

const bundleId = (() => {
  const id = process.env.APP_BUNDLE_ID || DEV_BUNDLE_ID;
  if (IS_PRODUCTION_BUILD) {
    if (id === DEV_BUNDLE_ID || /REPLACE|anonymous|example/i.test(id)) {
      throw new Error(
        'APP_BUNDLE_ID must be set to the final bundle identifier for production builds '
        + '(e.g. in.onemessage.app). Set it in eas.json → build.production.env.'
      );
    }
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(id)) {
      throw new Error(`APP_BUNDLE_ID "${id}" is not a valid reverse-DNS identifier.`);
    }
  }
  return id;
})();

const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || '';
const iosMapsKey = process.env.GOOGLE_MAPS_IOS_API_KEY || '';
if (IS_PRODUCTION_BUILD && (!androidMapsKey || !iosMapsKey)) {
  throw new Error('GOOGLE_MAPS_ANDROID_API_KEY and GOOGLE_MAPS_IOS_API_KEY must be set for production builds.');
}
if (IS_PRODUCTION_BUILD && process.env.EAS_BUILD_PLATFORM === 'android' && !process.env.GOOGLE_SERVICES_JSON) {
  throw new Error('GOOGLE_SERVICES_JSON (EAS file variable) must be set for Android production builds — push notifications need it.');
}

// Purpose strings. Apple rejects vague ones (guideline 5.1.1); each says what
// is used, by whom, and when it stops.
const LOCATION_WHEN_IN_USE =
  'Riders share their location during a Sehri delivery round, so the members they are delivering to can follow it on a map. Location is used only while a rider has started a round, and stops when they finish.';
const LOCATION_ALWAYS =
  'OneMessage does not use your location in the background when you are not delivering. During a delivery round a rider starts, location is shared until they finish the round.';
const PHOTOS =
  'Choose a screenshot of your UPI payment so a volunteer can confirm your donation. Only the image you pick is uploaded.';

module.exports = () => ({
  expo: {
    name: 'OneMessage',
    slug: 'one-message',
    owner: process.env.EXPO_OWNER || undefined,
    version: '1.0.0',
    // Build numbers are managed by EAS (eas.json: appVersionSource "remote",
    // autoIncrement on production), so every store upload is unique without
    // anyone editing this file.
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'onemessage',
    // The app has one visual system (deep teal + gold on paper) and no dark
    // theme. "automatic" let iOS/Android dark mode turn the status bar icons
    // white on the app's light background.
    userInterfaceStyle: 'light',
    ios: {
      bundleIdentifier: bundleId,
      // Phone-only. The layouts are designed for phones, and a tablet
      // listing would require iPad screenshots and an iPad-quality layout.
      supportsTablet: false,
      config: {
        googleMapsApiKey: iosMapsKey,
      },
      infoPlist: {
        NSLocationWhenInUseUsageDescription: LOCATION_WHEN_IN_USE,
        NSLocationAlwaysAndWhenInUseUsageDescription: LOCATION_ALWAYS,
        NSLocationAlwaysUsageDescription: LOCATION_ALWAYS,
        // Background location runs only as the continuation of a round the
        // rider started in the foreground (with the blue indicator showing);
        // "Always" permission is never requested.
        UIBackgroundModes: ['location'],
        ITSAppUsesNonExemptEncryption: false,
      },
      // Required-reason API declarations (Apple, since May 2024). React
      // Native and Expo modules ship their own manifests; these cover the
      // app-level uses the build aggregates.
      privacyManifests: {
        NSPrivacyTracking: false,
        NSPrivacyTrackingDomains: [],
        NSPrivacyAccessedAPITypes: [
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
        ],
        NSPrivacyCollectedDataTypes: [
          { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeName', NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] },
          { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhoneNumber', NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] },
          { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhysicalAddress', NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] },
          { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePreciseLocation', NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] },
          { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhotosorVideos', NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] },
          { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherUserContent', NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] },
          { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherFinancialInfo', NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] },
          { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCustomerSupport', NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] },
          { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeUserID', NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] },
          { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID', NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] },
          { NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCrashData', NSPrivacyCollectedDataTypeLinked: false, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] },
        ],
      },
    },
    android: {
      package: bundleId,
      // Firebase config for FCM, which Expo push uses as its Android
      // transport. Supplied as an EAS "file" environment variable
      // (GOOGLE_SERVICES_JSON), never committed. Without it an Android
      // release build cannot obtain a push token at all.
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON || undefined,
      adaptiveIcon: {
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
        backgroundColor: '#012718',
      },
      predictiveBackGestureEnabled: false,
      // Cleartext HTTP: release builds target API 36, where it is off by
      // default; only the debug manifest (for Metro) enables it. The API URL
      // itself must be https in release builds — see api/client.js.
      config: {
        googleMaps: { apiKey: androidMapsKey },
      },
      // Exactly what the app uses. Location: the rider's delivery feed runs
      // as a user-started foreground service, which on Android 10+ keeps
      // location flowing with the screen off WITHOUT background location —
      // so ACCESS_BACKGROUND_LOCATION (and Play's background-location
      // declaration and video) is not needed at all.
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'FOREGROUND_SERVICE',
        'FOREGROUND_SERVICE_LOCATION',
        'POST_NOTIFICATIONS',
      ],
      blockedPermissions: [
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.RECORD_AUDIO',
        'android.permission.CAMERA',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_MEDIA_AUDIO',
      ],
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      withoutBackgroundFetch,
      'expo-router',
      [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: androidMapsKey,
          iosGoogleMapsApiKey: iosMapsKey,
        },
      ],
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          imageWidth: 240,
          resizeMode: 'contain',
          backgroundColor: '#012718',
          dark: { backgroundColor: '#012718' },
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/images/notification-icon.png',
          color: '#E6B64F',
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission: LOCATION_WHEN_IN_USE,
          locationAlwaysAndWhenInUsePermission: LOCATION_ALWAYS,
          locationAlwaysPermission: LOCATION_ALWAYS,
          // Motion activity is never read; without false the plugin adds a
          // generic "detect your motion activity" string anyway.
          motionUsagePermission: false,
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: false,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      [
        'expo-image-picker',
        {
          // The picker (PHPicker on iOS, the system Photo Picker on Android)
          // needs no library-wide permission. Camera and microphone are
          // never used, so their permissions are blocked outright.
          photosPermission: PHOTOS,
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
      'expo-task-manager',
      // Tokens are stored in the Keychain without biometric gating, so no
      // Face ID purpose string (the plugin's default is a generic one).
      ['expo-secure-store', { faceIDPermission: false }],
      'expo-font',
      'expo-image',
      'expo-status-bar',
      [
        '@sentry/react-native/expo',
        {
          organization: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
    },
  },
});
