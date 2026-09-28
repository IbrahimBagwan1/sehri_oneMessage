'use strict';

/**
 * secure-donation-screenshots.js — move existing payment screenshots from
 * public to authenticated Cloudinary delivery.
 *
 * New uploads are authenticated already (donationController). This converts
 * the rows uploaded before that change. Converting an asset keeps its public
 * id and changes its delivery type, so the permanent public URL stops
 * working and the app is handed expiring links instead.
 *
 *   node scripts/secure-donation-screenshots.js            # dry run: list what would change
 *   node scripts/secure-donation-screenshots.js --apply    # convert
 *   node scripts/secure-donation-screenshots.js --revert   # back to public (undo)
 *
 * Safe to re-run: rows already in the target state are skipped. Each row is
 * updated only after Cloudinary confirms the asset moved.
 */

require('dotenv').config({ quiet: true });
const { v2: cloudinary } = require('cloudinary');
const db = require('../src/models');
const cloudinaryService = require('../src/services/cloudinaryService');

const apply = process.argv.includes('--apply');
const revert = process.argv.includes('--revert');

(async () => {
  if (!cloudinaryService.isConfigured()) {
    console.error('Cloudinary is not configured (CLOUDINARY_URL).');
    process.exit(1);
  }
  cloudinary.config({ secure: true });

  const from = revert ? 'authenticated' : 'public';
  const to = revert ? 'public' : 'authenticated';
  const rows = await db.Donation.findAll({
    where: { screenshot_access: from },
    attributes: ['id', 'screenshot_url', 'screenshot_public_id', 'screenshot_format', 'screenshot_access'],
  });
  const candidates = rows.filter((r) => r.screenshot_public_id || cloudinaryService.publicIdFromUrl(r.screenshot_url));
  console.log(`${candidates.length} screenshot(s) are ${from}${apply || revert ? '' : ' (dry run — pass --apply to convert)'}`);
  if (!apply && !revert) { await db.sequelize.close(); return; }

  let done = 0;
  let failed = 0;
  for (const row of candidates) {
    const publicId = row.screenshot_public_id || cloudinaryService.publicIdFromUrl(row.screenshot_url);
    try {
      const result = await cloudinary.uploader.rename(publicId, publicId, {
        resource_type: 'image',
        type: from === 'public' ? 'upload' : 'authenticated',
        to_type: to === 'public' ? 'upload' : 'authenticated',
        invalidate: true,
      });
      await row.update({
        screenshot_public_id: publicId,
        screenshot_format: row.screenshot_format || result.format || null,
        screenshot_access: to,
        // A converted asset has no permanent URL worth keeping; a reverted
        // one gets its public URL back.
        screenshot_url: to === 'public' ? result.secure_url : null,
      });
      done += 1;
    } catch (err) {
      failed += 1;
      console.error(`  ${row.id}: ${err.message || err.error?.message || err}`);
    }
  }
  console.log(`converted ${done}, failed ${failed}`);
  await db.sequelize.close();
  process.exit(failed ? 1 : 0);
})().catch(async (err) => {
  console.error(err);
  await db.sequelize.close();
  process.exit(1);
});
