import { Alert, Linking } from 'react-native';

/**
 * legal.js — every link out to the public site, in one place.
 *
 * WHY A CONSTANTS MODULE RATHER THAN INLINE STRINGS
 * These URLs are submitted to Google Play Console and App Store Connect, and
 * a reviewer follows them. If the domain ever moves, a string scattered over
 * five screens is a string that gets half-updated, and the half left behind
 * is a dead policy link in a shipped build — which is a rejection, not a bug
 * report. One constant, one change.
 *
 * WHERE EACH ONE IS REQUIRED
 *   privacy   — App Store Connect "Privacy Policy URL" and Play Console
 *               "Privacy policy". Apple 5.1.1(i) also wants it reachable
 *               from inside the app, not only from the listing.
 *   support   — App Store Connect "Support URL" (mandatory). Apple 1.2 also
 *               requires published contact information for an app carrying
 *               user-generated content.
 *   terms     — the agreement a new member accepts at registration. Apple
 *               1.2 expects UGC apps to have one.
 *   guidelines— the content rules those terms refer to; linked from the
 *               reporting flow so someone reporting abuse can see the
 *               standard they are reporting against.
 *   childSafety — Play Console "Child safety standards", mandatory for an
 *               app with chat.
 *   deleteAccount — Play Console's account-deletion URL. Deleting works
 *               inside the app too; this page explains what is kept.
 */

export const SITE_URL = 'https://onemessage-official.vercel.app';

export const LEGAL_URLS = {
  home:          SITE_URL,
  privacy:       `${SITE_URL}/privacy-policy`,
  terms:         `${SITE_URL}/terms`,
  support:       `${SITE_URL}/support`,
  guidelines:    `${SITE_URL}/community-guidelines`,
  childSafety:   `${SITE_URL}/child-safety`,
  deleteAccount: `${SITE_URL}/delete-account`,
};

/**
 * Open one of the links above in the device browser.
 *
 * Deliberately the system browser rather than a WebView: a policy page shown
 * inside the app is a page the app could in principle have altered, and both
 * stores would rather a reviewer — and a member — saw the real URL in a real
 * address bar. It also means the back gesture behaves the way people expect.
 *
 * Never throws. If the link cannot be opened we show the URL so it can still
 * be reached by hand, which matters when the thing that failed is the page
 * explaining how to delete your account.
 */
export const openLegalUrl = async (url, label = 'that page') => {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error('unsupported');
    await Linking.openURL(url);
    return true;
  } catch {
    Alert.alert(
      `Couldn't open ${label}`,
      `Visit ${url} in your browser.`
    );
    return false;
  }
};
