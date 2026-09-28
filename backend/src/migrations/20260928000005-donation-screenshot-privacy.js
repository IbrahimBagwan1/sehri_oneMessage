'use strict';

/**
 * Payment screenshots move from public delivery to Cloudinary "authenticated"
 * delivery.
 *
 * A screenshot shows the payer's name and UPI handle. It used to be stored
 * as a public Cloudinary URL: unguessable, but permanent — anyone who ever
 * got hold of the link (a forwarded message, a log, a screen recording)
 * could open it forever. Authenticated assets refuse unsigned requests; the
 * API now hands out a link that expires after an hour, generated per
 * request (services/cloudinaryService.screenshotViewUrl).
 *
 * New columns:
 *   screenshot_public_id  the asset id (for signing and deletion)
 *   screenshot_format     file extension, needed to sign a download link
 *   screenshot_access     'public' (legacy rows) | 'authenticated'
 *
 * Existing rows keep working as 'public' until scripts/secure-donation-
 * screenshots.js converts them. Their public id is backfilled here from the
 * stored URL. Idempotent: safe to re-run after a partial failure.
 */

const { addColumnIfMissing, removeColumnIfExists } = require('../utils/migrationHelpers');

const publicIdFromUrl = (url) => {
  const m = typeof url === 'string' && url.match(/\/upload\/(?:v\d+\/)?(.+)\.([a-z0-9]+)$/i);
  return m ? { publicId: m[1], format: m[2].toLowerCase() } : null;
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await addColumnIfMissing(queryInterface, 'donations', 'screenshot_public_id', {
      type: Sequelize.STRING(255), allowNull: true,
    });
    await addColumnIfMissing(queryInterface, 'donations', 'screenshot_format', {
      type: Sequelize.STRING(10), allowNull: true,
    });
    await addColumnIfMissing(queryInterface, 'donations', 'screenshot_access', {
      type: Sequelize.ENUM('public', 'authenticated'), allowNull: false, defaultValue: 'public',
    });

    const [rows] = await queryInterface.sequelize.query(
      'SELECT id, screenshot_url FROM donations WHERE screenshot_url IS NOT NULL AND screenshot_public_id IS NULL'
    );
    for (const row of rows) {
      const parsed = publicIdFromUrl(row.screenshot_url);
      if (!parsed) continue;
      await queryInterface.sequelize.query(
        'UPDATE donations SET screenshot_public_id = :pid, screenshot_format = :fmt WHERE id = :id',
        { replacements: { pid: parsed.publicId, fmt: parsed.format, id: row.id } }
      );
    }
  },

  down: async (queryInterface) => {
    // Authenticated rows have no public URL; they keep their asset but lose
    // the columns that let the old code find it. Run
    // scripts/secure-donation-screenshots.js --revert first if they matter.
    await removeColumnIfExists(queryInterface, 'donations', 'screenshot_access');
    await removeColumnIfExists(queryInterface, 'donations', 'screenshot_format');
    await removeColumnIfExists(queryInterface, 'donations', 'screenshot_public_id');
  },
};
