'use strict';

/**
 * Payment screenshots: authenticated assets are only ever handed out as
 * expiring signed links; legacy public rows keep their stored URL. Runs
 * offline — Cloudinary signing is local, with dummy credentials.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CLOUDINARY_URL = 'cloudinary://111111111111111:dummysecretdummysecret@demo-cloud';
const cloudinaryService = require('../../src/services/cloudinaryService');

test('an authenticated screenshot becomes a signed link that expires within the hour', () => {
  const before = Math.floor(Date.now() / 1000);
  const url = cloudinaryService.screenshotViewUrl({
    screenshot_access: 'authenticated',
    screenshot_public_id: 'onemessage/donations/abc123',
    screenshot_format: 'jpg',
    screenshot_url: null,
  });
  const u = new URL(url);
  assert.equal(u.hostname, 'api.cloudinary.com');
  assert.equal(u.searchParams.get('type'), 'authenticated');
  assert.equal(u.searchParams.get('public_id'), 'onemessage/donations/abc123');
  assert.ok(u.searchParams.get('signature'), 'signed');
  const expires = Number(u.searchParams.get('expires_at'));
  assert.ok(expires > before && expires <= before + cloudinaryService.VIEW_LINK_TTL_SECONDS + 5, 'expires within the TTL');
  assert.ok(!url.includes('dummysecret'), 'the API secret never appears in the link');
});

test('a legacy public screenshot keeps its stored URL until converted', () => {
  const stored = 'https://res.cloudinary.com/demo-cloud/image/upload/v1/onemessage/donations/old.jpg';
  assert.equal(cloudinaryService.screenshotViewUrl({ screenshot_access: 'public', screenshot_url: stored }), stored);
});

test('no screenshot, no link', () => {
  assert.equal(cloudinaryService.screenshotViewUrl({ screenshot_access: 'public', screenshot_url: null }), null);
  assert.equal(cloudinaryService.screenshotViewUrl(null), null);
});
