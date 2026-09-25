import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/useAuthStore';
import { Button, RubStar } from './ui';
import { colors, radius, space, type } from '../theme';

/**
 * RoleSwitcher — one affordance for "which hat am I wearing?", shared by
 * every dashboard.
 *
 * It used to be two different things. The member home screen had a round
 * icon button beside the avatar opening a bottom sheet; the zone-admin and
 * super-admin dashboards had a "Switch to" label with a row of chips sitting
 * in the page body under the hero. Same action, two designs, and on the
 * dashboards it cost a whole row of vertical space on screens that are
 * mostly numbers. Now all three render this.
 *
 * Drop it in the Header's `trailing` slot, beside the Avatar:
 *
 *   <View style={styles.headerActions}>
 *     <RoleSwitcher />
 *     <Avatar ... />
 *   </View>
 *
 * It reads the auth store itself and renders NOTHING when there is nothing
 * to switch to — an ordinary member, a guest, or a standalone admin with no
 * linked user account never sees it. (That last case is what the "Link a
 * user account" card on the dashboards is for; it stays where it is,
 * because it's an onboarding prompt, not a switcher.)
 */

/**
 * The roles a signed-in person can hold, and how each is presented.
 * Keyed by the role string the backend issues.
 *
 * `user` is included so the sheet can name the role you are currently in,
 * not just the ones you can move to.
 */
export const ROLE_META = {
  user:        { label: 'Member',      icon: 'person-outline',  blurb: 'Vote, track delivery, and chat' },
  rider:       { label: 'Rider',       icon: 'bicycle-outline', blurb: "Today's delivery route and stops" },
  admin:       { label: 'Zone admin',  icon: 'shield-outline',  blurb: 'Approve members and see your zone' },
  super_admin: { label: 'Super admin', icon: 'key-outline',     blurb: 'Full community administration' },
};

/** Where each role lands once the token has been swapped. */
const HOME_ROUTE = {
  user:        '/(user)',
  admin:       '/(admin)',
  super_admin: '/super-admin/superadmin-dashboard',
};

export default function RoleSwitcher({ fallbackRole = 'user' }) {
  const router          = useRouter();
  const isGuest         = useAuthStore((s) => s.isGuest);
  const active_role     = useAuthStore((s) => s.active_role);
  const available_roles = useAuthStore((s) => s.available_roles);
  const switchRole      = useAuthStore((s) => s.switchRole);

  const [open, setOpen]           = useState(false);
  const [switching, setSwitching] = useState(null);

  // Roles this person can switch INTO — everything they hold except the one
  // they are already using.
  //
  // `fallbackRole` covers active_role being unset: the screen rendering this
  // knows which role it belongs to. Without it, a null role would leave the
  // current view in the list and offer to switch you to where you already are.
  const switchable = useMemo(() => {
    const current = active_role || fallbackRole;
    return (available_roles || []).filter((r) => r !== current && ROLE_META[r]);
  }, [available_roles, active_role, fallbackRole]);

  if (isGuest || switchable.length === 0) return null;

  const handlePick = async (role) => {
    if (switching) return;           // ignore double-taps mid-switch
    setSwitching(role);
    try {
      const result = await switchRole(role);
      setOpen(false);
      // The rider app keeps its own token pair, so it is pushed rather than
      // replaced — backing out returns you to the role you came from.
      if (result?.isRider) return router.push('/(rider)/map');
      return router.replace(HOME_ROUTE[role] || HOME_ROUTE.user);
    } catch (err) {
      Alert.alert(
        "Couldn't switch role",
        err?.response?.data?.message || 'Try again in a moment.'
      );
      return undefined;
    } finally {
      setSwitching(null);
    }
  };

  const activeLabel = ROLE_META[active_role || fallbackRole]?.label || 'member';

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        accessibilityRole="button"
        accessibilityLabel={`Switch role. You are signed in as ${activeLabel}.`}
      >
        <Ionicons name="swap-horizontal" size={19} color={colors.tealDark} />
      </Pressable>

      <RoleSwitchSheet
        visible={open}
        onClose={() => setOpen(false)}
        activeRole={active_role || fallbackRole}
        roles={switchable}
        switching={switching}
        onPick={handlePick}
      />
    </>
  );
}

/**
 * A bottom sheet rather than inline chips: the number of roles varies per
 * person (1–3), a sheet scales to any of them without reflowing the header,
 * and it matches the pattern this app already uses everywhere else for
 * "choose one of these" (profile pickers, PG actions, voter drill-downs).
 */
function RoleSwitchSheet({ visible, onClose, activeRole, roles, switching, onPick }) {
  const activeMeta = ROLE_META[activeRole];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => (switching ? null : onClose())}
    >
      <Pressable style={styles.overlay} onPress={() => (switching ? null : onClose())}>
        <Pressable style={styles.sheet} onPress={() => { /* absorb */ }}>
          <View style={styles.handle} />

          <View style={styles.head}>
            <View style={styles.ornamentRow}>
              <View style={styles.ornamentRule} />
              <RubStar size={11} />
              <View style={styles.ornamentRule} />
            </View>
            <Text style={styles.title}>Switch role</Text>
            {activeMeta ? (
              <Text style={styles.subtitle}>
                You&apos;re currently in <Text style={styles.subtitleStrong}>{activeMeta.label}</Text> view
              </Text>
            ) : null}
          </View>

          {roles.map((role) => {
            const meta = ROLE_META[role];
            const busy = switching === role;
            return (
              <Pressable
                key={role}
                onPress={() => onPick(role)}
                disabled={!!switching}
                style={({ pressed }) => [
                  styles.option,
                  pressed && !switching && styles.optionPressed,
                  !!switching && !busy && styles.optionMuted,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${meta.label}. ${meta.blurb}.`}
              >
                <View style={styles.optionIcon}>
                  <Ionicons name={meta.icon} size={19} color={colors.tealDark} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>{meta.label}</Text>
                  <Text style={styles.optionBlurb}>{meta.blurb}</Text>
                </View>
                {busy ? (
                  <ActivityIndicator size="small" color={colors.teal} />
                ) : (
                  <Ionicons name="chevron-forward" size={17} color={colors.inkGhost} />
                )}
              </Pressable>
            );
          })}

          <Button
            label="Cancel"
            variant="secondary"
            onPress={onClose}
            disabled={!!switching}
            fullWidth
            style={{ marginTop: space[3] }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Matches the Avatar it sits beside: same 38px circle, same optical weight.
  btn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.tealSoft,
    borderWidth: 1, borderColor: colors.tealBorder,
  },
  btnPressed: { backgroundColor: colors.tealBorder },

  overlay: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space[5],
    paddingTop: space[3],
    paddingBottom: space[5],
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.ruleSoft,
    marginBottom: space[3],
  },
  head: { alignItems: 'center', marginBottom: space[4] },
  ornamentRow: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    width: 130, marginBottom: space[1],
  },
  ornamentRule: { flex: 1, height: 1, backgroundColor: colors.goldBorder, opacity: 0.6 },
  title:          { ...type.h2, color: colors.ink },
  subtitle:       { ...type.meta, color: colors.inkMuted, marginTop: 3 },
  subtitleStrong: { fontWeight: '800', color: colors.tealDark },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    marginBottom: space[2],
  },
  optionPressed: { backgroundColor: colors.tealSoft, borderColor: colors.tealBorder },
  optionMuted:   { opacity: 0.45 },
  optionIcon: {
    width: 38, height: 38, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.tealSoft,
    borderWidth: 1, borderColor: colors.tealBorder,
  },
  optionLabel: { ...type.bodyStrong, color: colors.ink },
  optionBlurb: { ...type.micro, color: colors.inkFaint, marginTop: 2 },
});
