import React from 'react';
import { StyleSheet } from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardAvoidingView as KCKeyboardAvoidingView,
  KeyboardStickyView,
} from 'react-native-keyboard-controller';
import { space } from '../../theme';

/**
 * KeyboardAwareScroll — the one place the app solves "the keyboard is
 * covering the field I'm typing in".
 *
 * THE BUG THIS REPLACES
 * Every form screen used React Native's own KeyboardAvoidingView like this:
 *
 *     behavior={Platform.OS === 'ios' ? 'padding' : undefined}
 *
 * On Android `behavior={undefined}` makes KeyboardAvoidingView a no-op — it
 * renders a plain View and moves nothing. That was deliberate once: Android
 * used to resize the window itself via
 * `android:windowSoftInputMode="adjustResize"`, so JS had nothing to do.
 *
 * That stopped being true. Expo SDK 54+ enables edge-to-edge permanently on
 * Android (expo-modules-core applies it at activity start), and under
 * edge-to-edge the window is laid out *behind* the system bars and behind
 * the keyboard. adjustResize no longer shrinks the React root, so the
 * native lift the code was relying on never happens — and because the JS
 * side was switched off, nothing else happened either. Hence the keyboard
 * covering the input on every screen, on every Android device.
 *
 * WHY THIS LIBRARY RATHER THAN JUST FIXING `behavior`
 * Setting behavior="padding" on Android would lift the *container*, which
 * is not quite the goal. On a long form — register, with eight fields — the
 * container can be lifted and the field being typed into still be off
 * screen. KeyboardAwareScrollView scrolls the FOCUSED INPUT into view,
 * which is the thing the person actually needs. It also reads the real IME
 * inset frame-by-frame, so it stays correct under edge-to-edge instead of
 * guessing a height and over-padding by the navigation bar.
 *
 * Requires <KeyboardProvider> at the app root — see src/app/_layout.tsx.
 *
 * USAGE
 *   <SafeAreaView style={styles.screen}>
 *     <Header title="..." />
 *     <KeyboardAwareScroll contentContainerStyle={styles.scroll}>
 *       ...fields...
 *     </KeyboardAwareScroll>
 *   </SafeAreaView>
 *
 * This replaces a <KeyboardAvoidingView><ScrollView> pair — do not nest it
 * inside one, or the two will fight over the same inset.
 */

// Breathing room between the focused field and the top of the keyboard, so
// the input is not flush against it and any helper text below it stays
// readable. One step of the spacing scale.
const DEFAULT_BOTTOM_OFFSET = space[6];

export default function KeyboardAwareScroll({
  children,
  contentContainerStyle,
  style,
  bottomOffset = DEFAULT_BOTTOM_OFFSET,
  ...rest
}) {
  return (
    <KeyboardAwareScrollView
      style={[styles.flex, style]}
      contentContainerStyle={contentContainerStyle}
      bottomOffset={bottomOffset}
      // Without this, the first tap on a button while the keyboard is open
      // only dismisses the keyboard and the button has to be pressed twice.
      keyboardShouldPersistTaps="handled"
      {...rest}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}

/**
 * KeyboardAvoidingView — the library's version, re-exported under the name
 * the codebase already uses.
 *
 * For layouts that are NOT a scrolling form: a chat room whose composer has
 * to sit on top of the keyboard while the message list stays put, or a
 * bottom sheet inside a <Modal>. Unlike React Native's, this one works on
 * Android, so callers pass `behavior` once for both platforms rather than
 * branching on Platform.OS and disabling themselves on half their users.
 */
export { KCKeyboardAvoidingView as KeyboardAvoidingView, KeyboardStickyView };

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
