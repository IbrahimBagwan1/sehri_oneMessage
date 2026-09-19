import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, space, type } from '../../theme';
import RubStar from './RubStar';

/**
 * Hero — the salaam block at the top of a scrollable screen.
 *
 * Not a card. Sits directly on the screen background with a hairline
 * gold rule + centered ۞ underneath, giving the top of the page a
 * dignified "opening" without adding a heavy shadowed hero card that
 * every generic app tries to force in.
 *
 *   greeting   e.g. "Assalamu alaikum"
 *   name       the user's first name (or blank for logged-out state)
 *   dateLine   e.g. "Ramadan 15, 1447 · Wednesday, 19 September"
 *   trailing   optional right-side element (avatar, action)
 */
export default function Hero({ greeting, name, dateLine, trailing, style }) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.row}>
        <View style={styles.text}>
          {greeting ? <Text style={styles.greeting}>{greeting}</Text> : null}
          {name ? <Text style={styles.name}>{name}</Text> : null}
          {dateLine ? <Text style={styles.date}>{dateLine}</Text> : null}
        </View>
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>

      {/* Ornament divider — hairline gold rule bracketing a small ۞ */}
      <View style={styles.divider}>
        <View style={styles.rule} />
        <RubStar size={12} />
        <View style={styles.rule} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: space[5],
    paddingTop: space[5],
    paddingBottom: space[3],
  },
  row:      { flexDirection: 'row', alignItems: 'flex-start' },
  text:     { flex: 1 },
  greeting: { ...type.meta, color: colors.inkFaint },
  name:     { ...type.displayLg, marginTop: 2 },
  date:     { ...type.meta, marginTop: space[1] },
  trailing: { marginLeft: space[3] },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[4],
  },
  rule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.goldBorder,
    opacity: 0.6,
  },
});
