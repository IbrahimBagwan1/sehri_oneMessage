/**
 * components/ui — barrel export for the design-system primitives.
 *
 * Prefer:
 *   import { Button, Card, SectionHeader, LoadingState } from '../../components/ui';
 *
 * over deep imports into individual files.
 */
export { default as Avatar }         from './Avatar';
export { default as Button }         from './Button';
export { default as Calendar, todayISO } from './Calendar';
export { default as Card }           from './Card';
export { default as Chip }           from './Chip';
export { default as Divider }        from './Divider';
export { default as EmptyState }     from './EmptyState';
export { default as ErrorState }     from './ErrorState';
export { default as GuestGate }      from './GuestGate';
export { default as Header }         from './Header';
export { default as Hero }           from './Hero';
export { default as Input }          from './Input';
// Keyboard handling. Every screen with a text field should use one of
// these rather than react-native's KeyboardAvoidingView, which is a
// no-op on Android under edge-to-edge. See KeyboardAwareScroll.js.
export { default as KeyboardAwareScroll } from './KeyboardAwareScroll';
export { KeyboardAvoidingView, KeyboardStickyView } from './KeyboardAwareScroll';
export { default as LoadingState }   from './LoadingState';
export { default as RubStar }        from './RubStar';
export { default as SectionHeader }  from './SectionHeader';
