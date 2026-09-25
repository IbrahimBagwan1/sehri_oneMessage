# Store assets

Everything here is derived from one file: `logo-source.png`, the original
OneMessage artwork. Nothing in this folder or in
`frontend/assets/images/` is hand-edited — if the logo changes, replace
`logo-source.png` and run:

```bash
python store-assets/build-icons.py
```

which rewrites every icon in place.

## Why the shipped icon doesn't look identical to the source

`logo-source.png` is a *presentation* render: a rounded green tile with its
own gold border, sitting on a white page with a drop shadow. None of that
outer chrome belongs in an app icon — iOS and Android each apply their own
mask, so a baked-in border gets sliced at the corners and the white page
shows as a halo. The build script therefore removes the page, erodes the
tile's own border away, rebuilds the green field as a full-bleed gradient,
and composites the artwork back on top. The calligraphy, the mihrab arch and
the mosque are untouched.

## What gets generated

Into `frontend/assets/images/` (all referenced from `app.json`):

| file | size | used by |
|---|---|---|
| `icon.png` | 1024² RGB | iOS app icon, Android legacy icon. **No alpha channel** — App Store Connect rejects an icon that has one. |
| `android-icon-foreground.png` | 1024² RGBA | Adaptive icon foreground. Art sits inside the centre 62%, the safe zone every launcher mask is guaranteed to keep. |
| `android-icon-background.png` | 1024² RGB | Adaptive icon background — the green plate. |
| `android-icon-monochrome.png` | 1024² RGBA | Android 13+ themed icons. Only the alpha is read and then tinted, so this is a flat stencil with the strokes weighted up and the small English caption dropped. |
| `notification-icon.png` | 96² RGBA | Status bar. Android discards colour and draws the alpha at 24dp, so this is cut back to the arch, dome and minarets. Must stay all-white with transparency. |
| `splash-icon.png` | 1024² RGB | Splash. Same composition as the icon; its outer pixels are exactly the splash `backgroundColor`, so the square blends into the screen. |
| `favicon.png` | 48² | Web. |

Into this folder, for the store listings themselves (not bundled into the app):

| file | size | used by |
|---|---|---|
| `play-store-icon-512.png` | 512² RGB | Play Console → Store listing → App icon |
| `app-store-icon-1024.png` | 1024² RGB | App Store Connect → App Information |

## Brand colours, sampled from the artwork

| token | hex | where |
|---|---|---|
| deep green (field edge) | `#012718` | adaptive icon background, splash background |
| green (field centre) | `#0D492E` | the gradient's lighter centre |
| gold | `#E6B64F` | notification tint colour |

## Still needed before submission

- **A Play Store feature graphic, 1024×500.** Google requires one and it is a
  layout, not a crop — it needs the mark plus the app name on the green.
- **Screenshots**, per store.
