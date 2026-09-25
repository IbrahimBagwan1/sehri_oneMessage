# -*- coding: utf-8 -*-
"""
build-icons.py — derive every store/app icon asset from E:\\onemessage\\logo.png

The source art is a *presentation* render: a rounded green tile with its own
gold border, sitting on a white page with a drop shadow. None of that outer
chrome belongs in a shipped app icon — iOS and Android each apply their own
mask, so a baked-in border gets sliced at the corners and the white page
would show as a halo. So we:

  1. flood-fill the white page + shadow away to get an exact tile mask
  2. erode that mask to drop the tile's own gold border and bevel
  3. rebuild the green field as a smooth gradient (inpainted from the real
     pixels, so the original's lighting is preserved rather than guessed)
  4. composite the frameless artwork back onto that field, full bleed

Everything else (adaptive foreground/background, monochrome, splash,
notification, store icons) is derived from those two layers.
"""
import numpy as np
from PIL import Image, ImageFilter
from collections import deque
import os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logo-source.png')
IMG = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'assets', 'images')
STORE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(STORE, exist_ok=True)

im = Image.open(SRC).convert('RGB')
W, H = im.size
a = np.asarray(im).astype(np.float32)

# ---------------------------------------------------------------- 1. tile mask
mx, mn = a.max(axis=2), a.min(axis=2)
pale = (mx - mn < 28) & (mx > 150)
vis = np.zeros((H, W), bool)
dq = deque()
for x in range(W):
    for y in (0, H - 1):
        if pale[y, x] and not vis[y, x]:
            vis[y, x] = True; dq.append((y, x))
for y in range(H):
    for x in (0, W - 1):
        if pale[y, x] and not vis[y, x]:
            vis[y, x] = True; dq.append((y, x))
while dq:
    y, x = dq.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < H and 0 <= nx < W and pale[ny, nx] and not vis[ny, nx]:
            vis[ny, nx] = True; dq.append((ny, nx))
tile = ~vis

# ------------------------------------------------- 2. erode away the gold frame
# The frame plus its bevel measures ~20px, so a 26px disk erosion clears it
# without reaching the arch outline, which sits ~94px in from the tile edge.
from scipy import ndimage
ERODE = 26
yy, xx = np.ogrid[-ERODE:ERODE + 1, -ERODE:ERODE + 1]
disk = (xx ** 2 + yy ** 2) <= ERODE ** 2
inner = ndimage.binary_erosion(tile, structure=disk)
# Feather the cut so the artwork doesn't end on a hard jagged edge.
inner_soft = np.asarray(
    Image.fromarray((inner * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.5))
).astype(np.float32) / 255.0

ys, xs = np.where(inner)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
print(f'tile      : {tile.sum()/ (W*H):.1%} of frame')
print(f'inner bbox: ({x0},{y0})-({x1},{y1})  {x1-x0+1}x{y1-y0+1}')

# --------------------------------------------- 3. rebuild the green field layer
# Gold pixels are "unknown"; fill them by repeatedly blurring the known green
# and pasting the knowns back. A handful of passes floods the whole plate with
# a plausible green, and a final heavy blur turns it into the gradient.
gold = (a[:, :, 0] > 110) & (a[:, :, 0] > a[:, :, 2] + 45)
# Only genuinely green pixels seed the field. Restricting to "in the tile and
# not gold" is not enough: the render's drop shadow is dark enough to survive
# the flood fill, and those grey pixels otherwise get extrapolated outward and
# wash the corners out.
is_green = (a[:, :, 1] > a[:, :, 0] + 12) & (a[:, :, 1] >= a[:, :, 2])
known = tile & is_green & ~gold
edge_green = np.median(a[known & (np.arange(W)[None, :] < x0 + 40)], axis=0)

# Unknown pixels (gold artwork, and the whole white page outside the tile)
# take the colour of their nearest known green pixel. Extrapolating rather
# than flat-filling matters at the corners: a flat fill leaves the original
# tile's rounded outline showing through the final blur as a ghost edge.
_, idx = ndimage.distance_transform_edt(~known, return_indices=True)
field = a[idx[0], idx[1]]
field_px = np.asarray(
    Image.fromarray(field.astype(np.uint8)).filter(ImageFilter.GaussianBlur(70))
).astype(np.float32)
print('edge green:', tuple(int(v) for v in edge_green),
      '| centre   :', tuple(int(v) for v in field_px[H // 2, W // 2]))


def crop(arr_or_img, box):
    if isinstance(arr_or_img, np.ndarray):
        arr_or_img = Image.fromarray(arr_or_img.astype(np.uint8))
    return arr_or_img.crop(box)


# Square the inner box around its centre so nothing is squashed.
side = max(x1 - x0, y1 - y0) + 1
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)

art_rgb = crop(a, box).resize((1024, 1024), Image.LANCZOS)
art_a = crop((inner_soft * 255), box).resize((1024, 1024), Image.LANCZOS)
artwork = Image.merge('RGBA', (*art_rgb.split(), art_a))          # frameless art
field_sq = crop(field_px, box).resize((1024, 1024), Image.LANCZOS)  # green plate

# --------------------------------------------------------------- 4. write icons
def save(img, path, rgb=False):
    if rgb and img.mode != 'RGB':
        bg = Image.new('RGB', img.size, tuple(int(v) for v in edge_green))
        bg.paste(img, (0, 0), img if img.mode == 'RGBA' else None)
        img = bg
    img.save(path, 'PNG', optimize=True)
    print(f'  wrote {os.path.basename(path)}  {img.size} {img.mode}')


# a) main icon — full bleed, no alpha (the App Store rejects an alpha channel)
icon = field_sq.convert('RGB').copy()
icon.paste(artwork, (0, 0), artwork)
print('\nicons:')
save(icon, os.path.join(IMG, 'icon.png'), rgb=True)
save(icon.resize((512, 512), Image.LANCZOS), os.path.join(STORE, 'play-store-icon-512.png'), rgb=True)
save(icon, os.path.join(STORE, 'app-store-icon-1024.png'), rgb=True)
save(icon.resize((48, 48), Image.LANCZOS).convert('RGBA'), os.path.join(IMG, 'favicon.png'))

# b) adaptive background — the green plate, full bleed
save(field_sq.convert('RGB'), os.path.join(IMG, 'android-icon-background.png'), rgb=True)

# c) adaptive foreground — artwork inside the 66% safe zone, transparent around
SAFE = 0.62
fg = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
s_safe = int(1024 * SAFE)
fg.paste(artwork.resize((s_safe, s_safe), Image.LANCZOS),
         ((1024 - s_safe) // 2, (1024 - s_safe) // 2))
save(fg, os.path.join(IMG, 'android-icon-foreground.png'))

# d) monochrome — Android 13 themed icons read ONLY this layer's alpha and
#    tint it, so it has to survive as a flat stencil. The artwork is gold
#    linework, which thins to nothing at launcher size, so the strokes are
#    weighted up; the tiny English caption is dropped (illegible once tinted)
#    by discarding small connected components.
art_np = np.asarray(artwork).astype(np.float32)
gold_art = ((art_np[:, :, 0] > 110) & (art_np[:, :, 0] > art_np[:, :, 2] + 45)
            & (art_np[:, :, 3] > 128))
lbl, n = ndimage.label(gold_art)
sizes = ndimage.sum(gold_art, lbl, range(1, n + 1))
keep = np.isin(lbl, [i + 1 for i, sz in enumerate(sizes) if sz >= 2500])
stencil = ndimage.binary_dilation(keep, iterations=3)
stencil_img = Image.fromarray((stencil * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
white = Image.new('L', (1024, 1024), 255)
mono_full = Image.merge('RGBA', (white, white, white, stencil_img))
mono = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
mono.paste(mono_full.resize((s_safe, s_safe), Image.LANCZOS),
           ((1024 - s_safe) // 2, (1024 - s_safe) // 2))
save(mono, os.path.join(IMG, 'android-icon-monochrome.png'))

# e) splash — the same full-bleed composition as the app icon. Its outer
#    pixels are exactly the brand green the splash background is set to, so
#    the square blends into the screen instead of reading as a pasted tile;
#    the built-in vignette then does the work of a glow.
save(icon, os.path.join(IMG, 'splash-icon.png'), rgb=True)

# f) android notification icon — the status bar discards colour and draws the
#    alpha at 24dp. Nothing this detailed survives that, so the glyph is cut
#    back to structural linework only: the mihrab arch, the dome and the
#    minarets. Those are the largest strokes in the artwork, so a size filter
#    isolates them and drops the calligraphy and caption. They are then
#    dilated hard enough to stay ~2px wide once scaled to 24dp.
NOTIF_MIN_PX, NOTIF_WEIGHT = 15000, 22
struct = np.isin(lbl, [i + 1 for i, sz in enumerate(sizes) if sz >= NOTIF_MIN_PX])
struct = ndimage.binary_dilation(struct, iterations=NOTIF_WEIGHT)
ny_, nx_ = np.where(struct)
pad = 20
nb = (max(nx_.min() - pad, 0), max(ny_.min() - pad, 0),
      min(nx_.max() + pad, 1023), min(ny_.max() + pad, 1023))
glyph = Image.fromarray((struct * 255).astype(np.uint8)).crop(nb)
side_n = max(glyph.size)
sq = Image.new('L', (side_n, side_n), 0)
sq.paste(glyph, ((side_n - glyph.size[0]) // 2, (side_n - glyph.size[1]) // 2))
w96 = Image.new('L', (96, 96), 255)
save(Image.merge('RGBA', (w96, w96, w96, sq.resize((96, 96), Image.LANCZOS))),
     os.path.join(IMG, 'notification-icon.png'))

print('\nbrand colours')
print('  deep green (field edge):  #%02X%02X%02X' % tuple(int(v) for v in edge_green))
print('  green (centre):           #%02X%02X%02X' % tuple(int(v) for v in field_px[H // 2, W // 2]))
gold_px = a[gold & tile]
print('  gold (mean):              #%02X%02X%02X' % tuple(int(v) for v in gold_px.mean(axis=0)))
