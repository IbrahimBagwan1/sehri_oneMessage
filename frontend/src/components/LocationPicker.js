import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { locationsApi } from '../api/auth';
import { Chip, LoadingState } from './ui';
import { colors, radius, space, type } from '../theme';

// -----------------------------------------------------------------------------
// LocationPicker — cascading City → Region → Area → Zone → PG selector.
//
// Deliberately hierarchy-AGNOSTIC rather than five hardcoded steps:
// it starts at the root (type='city') and, after each pick, asks the
// backend for that node's children. It stops when a node has no
// children left. That means:
//
//   • It renders however many levels the data actually has today
//     (city → region → area → zone → PG), and picks up new levels
//     automatically if the hierarchy is extended again later.
//   • A branch that legitimately skips a level (a zone with no PGs
//     under it, say) simply ends there and that zone becomes the
//     selected location — no dead "PG" step with nothing in it.
//
// The selected location id is always the DEEPEST node the user picked,
// which is what users.location_id must store for zone resolution and
// delivery routing to work.
//
// Props
//   value        location id currently selected (for pre-seeding on edit)
//   onChange     ({ id, name, chain }) => void   fires on every pick;
//                `chain` is the full [{id,name,type}] path, root-first
//   disabled     renders read-only
//   initialChain [{ id, name, type }] root-first — pre-expands the
//                picker to an existing selection without re-deriving it
// -----------------------------------------------------------------------------

// Human labels per level. Falls back to the raw type for any level
// added later that isn't in this map.
const LEVEL_LABEL = {
  city:    'City',
  region:  'Region',
  area:    'Area',
  zone:    'Zone',
  address: 'PG or hostel',
};

// Order we expect to walk. Used only to label a level whose `type` we
// haven't seen yet — never to gate what's fetched.
const levelLabel = (t) => LEVEL_LABEL[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Location');

export default function LocationPicker({
  value = null,
  onChange,
  disabled = false,
  initialChain = null,
}) {
  // steps[i] = { type, options: [...], selected: {id,name,type} | null }
  const [steps, setSteps]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingChild, setLoadingChild] = useState(false);
  const [error, setError]   = useState(null);

  // Guards an async race: if the user taps a different chip while a
  // children-fetch is in flight, the stale response must not land.
  const requestSeq = useRef(0);

  // ---- Initial load: the root level (cities) ------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await locationsApi.getLocations({ type: 'city' });
        if (!alive) return;
        const cities = res.data || [];

        // Seed from an existing selection when editing an profile.
        if (initialChain && initialChain.length > 0) {
          const seeded = [];
          let opts = cities;
          for (const node of initialChain) {
            seeded.push({ type: node.type, options: opts, selected: node });
            // eslint-disable-next-line no-await-in-loop
            const childRes = await locationsApi.getLocations({ parent_id: node.id });
            const children = childRes.data || [];
            if (children.length === 0) { opts = []; break; }
            opts = children;
          }
          if (!alive) return;
          // Trailing unselected step for the next level down, if any.
          if (opts.length > 0) {
            seeded.push({ type: opts[0]?.type, options: opts, selected: null });
          }
          setSteps(seeded);
        } else if (cities.length === 1) {
          // Single city (the common case — Bangalore only). Auto-select
          // it and immediately expand the next level so the user isn't
          // forced to tap a control with exactly one option.
          const only = cities[0];
          const childRes = await locationsApi.getLocations({ parent_id: only.id });
          if (!alive) return;
          const children = childRes.data || [];
          const next = [{ type: 'city', options: cities, selected: only }];
          if (children.length > 0) {
            next.push({ type: children[0]?.type, options: children, selected: null });
          }
          setSteps(next);
        } else {
          setSteps([{ type: 'city', options: cities, selected: null }]);
        }
      } catch {
        if (alive) setError("Couldn't load locations. Pull to retry or restart the app.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // initialChain is only read on mount — re-seeding mid-edit would
    // stomp whatever the user is in the middle of picking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror steps into a ref so handlePick can read the current value
  // without adding `steps` to its dependency list (which would recreate
  // the callback on every pick and remount every Chip).
  // MUST be declared before handlePick — keep it that way.
  const stepsRef = useRef(steps);
  useEffect(() => { stepsRef.current = steps; }, [steps]);

  // ---- Pick a node at a given level --------------------------------------
  const handlePick = useCallback(async (levelIndex, node) => {
    if (disabled) return;
    const seq = ++requestSeq.current;

    // Root-first path to the node just picked. Read from the ref
    // because `steps` in this closure is the render-time snapshot.
    const chain = [];
    for (let i = 0; i < levelIndex; i += 1) {
      const s = stepsRef.current[i];
      if (s?.selected) chain.push(s.selected);
    }
    chain.push(node);

    // Truncate everything below this level, then mark the pick.
    setSteps((prev) => {
      const next = prev.slice(0, levelIndex + 1);
      next[levelIndex] = { ...next[levelIndex], selected: node };
      return next;
    });

    setLoadingChild(true);
    try {
      const res = await locationsApi.getLocations({ parent_id: node.id });
      if (seq !== requestSeq.current) return; // a newer pick won
      const children = res.data || [];

      setSteps((prev) => {
        const next = prev.slice(0, levelIndex + 1);
        if (children.length > 0) {
          next.push({ type: children[0]?.type, options: children, selected: null });
        }
        return next;
      });

      // The deepest picked node IS the selection. If this node has no
      // children, the user is done. If it does have children we still
      // report it, so a partially-specified location round-trips
      // (e.g. a zone with no PGs configured under it yet) — the caller
      // uses `isLeaf` to decide whether to let the form submit.
      //
      // `hasZone` is the one the caller MUST gate on. Delivery routing
      // resolves a user's zone by walking UP from their location_id, so
      // a location_id that sits above the zone level (an area with no
      // zones configured under it, say) can never resolve — that user's
      // first vote would fail with "Could not resolve your zone". We
      // surface it here so the form can block submission with a
      // readable message instead of letting them register into a
      // broken state.
      onChange?.({
        id: node.id,
        name: node.name,
        chain,
        isLeaf: children.length === 0,
        hasZone: chain.some((n) => n.type === 'zone' || n.type === 'address'),
      });
    } catch {
      if (seq === requestSeq.current) {
        setError("Couldn't load the next level. Try picking again.");
      }
    } finally {
      if (seq === requestSeq.current) setLoadingChild(false);
    }
  }, [disabled, onChange]);

  if (loading) return <LoadingState message="Loading locations…" compact />;

  if (error) {
    return (
      <View style={styles.errorBox}>
        <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (steps.length === 0) {
    return <Text style={styles.hint}>No locations are configured yet.</Text>;
  }

  // Deepest node the user has actually picked, and whether the path to
  // it passes through a zone (see the hasZone note in handlePick).
  const selectedChain  = steps.filter((s) => s.selected).map((s) => s.selected);
  const deepestSelected = selectedChain.length > 0 ? selectedChain[selectedChain.length - 1] : null;
  const deepestHasZone  = selectedChain.some((n) => n.type === 'zone' || n.type === 'address');

  return (
    <View>
      {steps.map((step, i) => {
        // A level with exactly one option that's already selected is
        // shown as a read-only line rather than a single lonely chip.
        const isAutoSingle = step.options.length === 1 && step.selected;
        return (
          <View key={`${step.type}-${i}`} style={styles.level}>
            <View style={styles.levelHead}>
              <Text style={styles.levelLabel}>{levelLabel(step.type)}</Text>
              {step.selected ? (
                <Ionicons name="checkmark-circle" size={14} color={colors.success} />
              ) : (
                <Text style={styles.levelPending}>Select</Text>
              )}
            </View>

            {isAutoSingle ? (
              <View style={styles.readonlyBox}>
                <Ionicons name="location-outline" size={15} color={colors.inkFaint} />
                <Text style={styles.readonlyText}>{step.selected.name}</Text>
              </View>
            ) : (
              <View style={styles.chipWrap}>
                {step.options.map((opt) => (
                  <Chip
                    key={opt.id}
                    label={opt.name}
                    tone={step.selected?.id === opt.id ? 'teal' : 'neutral'}
                    selected={step.selected?.id === opt.id}
                    icon={step.type === 'address' ? 'home-outline' : 'location-outline'}
                    onPress={() => handlePick(i, opt)}
                  />
                ))}
              </View>
            )}
          </View>
        );
      })}

      {loadingChild && (
        <View style={styles.childLoading}>
          <LoadingState message="Loading…" compact />
        </View>
      )}

      {/* Breadcrumb of what's picked so far — reassures the user the
          cascade captured the right place before they submit. */}
      {steps.some((s) => s.selected) && (
        <View style={styles.trail}>
          <Ionicons name="navigate-outline" size={13} color={colors.tealDark} />
          <Text style={styles.trailText}>
            {steps.filter((s) => s.selected).map((s) => s.selected.name).join(' · ')}
          </Text>
        </View>
      )}

      {/* Dead-end warning. Some branches genuinely have nothing under
          them yet (an area with no zones configured). Stopping there
          would produce a location the delivery system can't route to,
          so say so plainly rather than letting the form submit. */}
      {!loadingChild && deepestSelected && !deepestHasZone && (
        <View style={styles.warnBox}>
          <Ionicons name="alert-circle-outline" size={15} color={colors.warn} />
          <Text style={styles.warnText}>
            No delivery zones are set up under {deepestSelected.name} yet.
            Pick a different {levelLabel(deepestSelected.type).toLowerCase()}, or
            ask an admin to add your PG here.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  level: { marginBottom: space[4] },
  levelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginBottom: space[2],
  },
  levelLabel:   { ...type.meta, color: colors.inkMuted, fontWeight: '600' },
  levelPending: { ...type.micro, color: colors.inkGhost },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },

  readonlyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.ruleFaint,
    paddingHorizontal: space[3],
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
  },
  readonlyText: { ...type.body, color: colors.inkMuted },

  childLoading: { paddingVertical: space[2] },

  trail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: space[1],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    backgroundColor: colors.tealSoft,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  trailText: { ...type.micro, color: colors.tealDark, flex: 1, fontWeight: '600' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: { ...type.meta, color: colors.danger, flex: 1 },

  hint: { ...type.meta, fontStyle: 'italic', color: colors.inkFaint },

  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    marginTop: space[3],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.warnSoft,
    borderWidth: 1,
    borderColor: colors.warn,
  },
  warnText: { ...type.micro, color: colors.warn, flex: 1, lineHeight: 16, fontWeight: '600' },
});
