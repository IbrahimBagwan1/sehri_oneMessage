import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, type } from '../theme';

// -----------------------------------------------------------------------------
// LeafletMap — a Google-key-free map replacement for our tracking screens.
//
// Why not react-native-maps here? On Android react-native-maps always uses
// Google Maps as the base provider (AOSP fallback is deprecated in RN Maps
// 1.x). Without a fully-configured Google Cloud project (Maps SDK for
// Android enabled, billing on, correct key + package restrictions, and a
// fresh prebuilt APK — none of which are guaranteed on Expo Go or a
// dev-client that predates the app.json plugin), the map renders as a
// solid black rectangle with only the Google watermark visible.
//
// This component sidesteps that entirely: a WebView loads Leaflet from
// unpkg + OpenStreetMap tiles. Works in Expo Go, dev builds, and prod
// on both iOS and Android with zero API-key wiring.
//
// Props
//   center       { latitude, longitude }        map's initial center
//   zoom         number, default 15
//   markers      [{ id, latitude, longitude, kind: 'rider'|'home', label? }]
//   polyline     [{latitude, longitude}, ...]   optional straight line
//   onReady      called once map first loads
//
// Ref methods
//   animateTo({ latitude, longitude, zoom? }) — pan the map smoothly
//   setMarkers(markers)                       — update marker set live
// -----------------------------------------------------------------------------

const DEFAULT_CENTER = { latitude: 12.9716, longitude: 77.5946 };
const DEFAULT_ZOOM   = 15;

/**
 * Build the initial HTML document. We pass initial center/zoom/markers
 * baked into the HTML rather than injectJavaScript so the map opens at
 * the right spot instead of centering-then-recentering.
 */
const buildHtml = (center, zoom, markers, polyline) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #F8FAFC; }
    .marker-pin {
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%;
      border: 3px solid #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-weight: 700;
      color: #fff;
    }
    .marker-rider { width: 36px; height: 36px; background: #0D9488; font-size: 18px; }
    .marker-home  { width: 28px; height: 28px; background: #FAF4E6; color: #B8860B;
                    border: 1px solid #E8D8A8; box-shadow: 0 1px 3px rgba(0,0,0,0.15); font-size: 14px; }
    .leaflet-control-attribution { font-size: 9px; opacity: 0.8; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
          integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <script>
    (function () {
      var post = function (msg) {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      };
      try {
        var map = L.map('map', {
          zoomControl: false,
          attributionControl: true,
        }).setView([${center.latitude}, ${center.longitude}], ${zoom});

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap',
        }).addTo(map);

        // Marker + polyline state kept in globals so setMarkers/animateTo
        // messages coming from React Native can mutate them.
        window.__markers  = {};
        window.__polyline = null;

        function iconFor(kind, label) {
          var cls = 'marker-pin marker-' + (kind === 'home' ? 'home' : 'rider');
          var text = label || (kind === 'home' ? '⌂' : '');
          return L.divIcon({
            className: '',
            html: '<div class="' + cls + '">' + text + '</div>',
            iconSize: kind === 'home' ? [28, 28] : [36, 36],
            iconAnchor: kind === 'home' ? [14, 14] : [18, 18],
          });
        }

        window.__renderMarkers = function (list) {
          Object.keys(window.__markers).forEach(function (id) {
            map.removeLayer(window.__markers[id]);
            delete window.__markers[id];
          });
          (list || []).forEach(function (m) {
            if (m.latitude == null || m.longitude == null) return;
            var marker = L.marker([m.latitude, m.longitude], { icon: iconFor(m.kind, m.label) });
            if (m.title) marker.bindTooltip(m.title, { direction: 'top', offset: [0, -12] });
            marker.addTo(map);
            window.__markers[m.id] = marker;
          });
        };

        window.__renderPolyline = function (coords) {
          if (window.__polyline) {
            map.removeLayer(window.__polyline);
            window.__polyline = null;
          }
          if (coords && coords.length >= 2) {
            var latlngs = coords.map(function (c) { return [c.latitude, c.longitude]; });
            window.__polyline = L.polyline(latlngs, {
              color: '#0D9488',
              weight: 3,
              opacity: 0.9,
              dashArray: '6, 8',
            }).addTo(map);
          }
        };

        window.__animateTo = function (lat, lng, z) {
          map.flyTo([lat, lng], z || map.getZoom(), { duration: 0.6 });
        };

        // Report tap coords back to React. The parent decides whether
        // to use them (pickable prop) — we always fire.
        map.on('click', function (e) {
          post({ type: 'press', latitude: e.latlng.lat, longitude: e.latlng.lng });
        });

        // Render initial state
        window.__renderMarkers(${JSON.stringify(markers || [])});
        window.__renderPolyline(${JSON.stringify(polyline || [])});
        post({ type: 'ready' });
      } catch (e) {
        post({ type: 'error', message: String(e && e.message || e) });
      }
    })();
  </script>
</body>
</html>`;

const LeafletMap = forwardRef(function LeafletMap(
  {
    center = DEFAULT_CENTER,
    zoom = DEFAULT_ZOOM,
    markers = [],
    polyline = null,
    onReady,
    onPress,
    style,
  },
  ref
) {
  const webRef = useRef(null);
  const readyRef = useRef(false);

  // The initial HTML is FROZEN — regenerating it would recreate the whole
  // WebView and blank the map. Post-mount changes flow through
  // injectJavaScript below so pan/marker updates are cheap.
  const html = useMemo(
    () => buildHtml(center, zoom, markers, polyline),
    // Deliberately no deps: initial only. Live updates via effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useImperativeHandle(ref, () => ({
    animateTo: ({ latitude, longitude, zoom: z }) => {
      if (!webRef.current || !readyRef.current) return;
      const js = `window.__animateTo && window.__animateTo(${latitude}, ${longitude}, ${z || 'null'}); true;`;
      webRef.current.injectJavaScript(js);
    },
  }));

  // Push marker updates to the WebView any time the array changes.
  useEffect(() => {
    if (!webRef.current || !readyRef.current) return;
    const js = `window.__renderMarkers && window.__renderMarkers(${JSON.stringify(markers)}); true;`;
    webRef.current.injectJavaScript(js);
  }, [markers]);

  // Push polyline updates similarly.
  useEffect(() => {
    if (!webRef.current || !readyRef.current) return;
    const js = `window.__renderPolyline && window.__renderPolyline(${JSON.stringify(polyline || [])}); true;`;
    webRef.current.injectJavaScript(js);
  }, [polyline]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        androidLayerType="hardware"
        // A WebView can silently reload — Android low-memory reclaim, some
        // navigation events, RN hot reload — after which our injected
        // globals (__renderMarkers, __animateTo) no longer exist. If we
        // don't reset readyRef here, subsequent marker/polyline updates
        // silently no-op against the fresh page and the map appears
        // frozen or blank. Flipping to false on onLoadStart makes those
        // effects wait until the fresh ready message arrives.
        onLoadStart={() => { readyRef.current = false; }}
        onMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data);
            if (msg.type === 'ready') {
              readyRef.current = true;
              // Re-push markers/polyline in case they changed while HTML
              // was still loading — the initial HTML has a snapshot but
              // if the props updated in the same tick we'd have missed it.
              if (webRef.current) {
                webRef.current.injectJavaScript(
                  `window.__renderMarkers(${JSON.stringify(markers)});` +
                  `window.__renderPolyline(${JSON.stringify(polyline || [])});` +
                  ` true;`
                );
              }
              onReady?.();
            } else if (msg.type === 'press' && onPress) {
              onPress({ latitude: msg.latitude, longitude: msg.longitude });
            }
          } catch (_) { /* ignore */ }
        }}
        renderError={() => (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Map failed to load. Check your internet connection.</Text>
          </View>
        )}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  web:       { flex: 1, backgroundColor: 'transparent' },
  errorBox:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { ...type.body, color: colors.inkFaint, textAlign: 'center' },
});

export default LeafletMap;
