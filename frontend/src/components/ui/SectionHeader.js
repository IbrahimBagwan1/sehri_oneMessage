import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, space, type } from '../../theme';
import RubStar from './RubStar';

/**
 * SectionHeader — the title strip above a card or block of content on
 * a screen.
 *
 *   title       required
 *   subtitle    optional caption below the title
 *   trailing    optional right-aligned React node (a Chip, a link, etc.)
 *   ornament    'star' shows a subtle ۞ to the right of the title
 *
 * Deliberate design constraint: sentence-case title, no uppercase
 * tracked labels. Emphasis is weight + size, not shouting.
 */
export default function SectionHeader({
  title,
  subtitle,
  trailing,
  ornament,
  style,
}) {
  return (
    <View style={[styles.wrapper, style]}>
      <View style={styles.row}>
        <View style={styles.titleWrap}>
          <View style={styles.titleLine}>
            <Text style={styles.title}>{title}</Text>
            {ornament === 'star' && (
              <RubStar size={13} style={styles.starOffset} />
            )}
          </View>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:   { marginBottom: space[3] },
  row:       { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  titleWrap: { flex: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center' },
  title:     type.h2,
  starOffset:{ marginLeft: space[2] },
  subtitle:  { ...type.meta, marginTop: 2 },
  trailing:  { marginLeft: space[3] },
});
