'use strict';

/**
 * GET /api/payment/info
 *
 * Returns the UPI/phone number to which donations should be sent, plus
 * the URL of the hosted payment page. Current app builds do not call this:
 * "View payment details" opens the OneMessage website's home page, which
 * carries the payment details. Kept for payment.html and for app builds
 * released before that change.
 *
 * The number comes from the PAYMENT_CONTACT_NUMBER env var. The
 * payment_url is derived from the current request so it works whether
 * the backend is hit via ngrok, localhost, or the production hostname —
 * no hardcoding needed.
 *
 * This endpoint is intentionally PUBLIC (no verifyToken) so the hosted
 * HTML page (which is also public) can hit it too.
 */

const express = require('express');
const router = express.Router();
const { success } = require('../utils/response');

const DEFAULT_CONTACT = '+91 96327 16392';

router.get('/info', (req, res) => {
  const contactNumber = process.env.PAYMENT_CONTACT_NUMBER || DEFAULT_CONTACT;

  // Derive the fully-qualified URL of the hosted page from the request.
  // req.protocol respects X-Forwarded-Proto when app.set('trust proxy')
  // is on — safe to use here.
  const paymentUrl = `${req.protocol}://${req.get('host')}/payment.html`;

  return success(res, {
    statusCode: 200,
    message: 'Payment info fetched.',
    data: {
      contact_number: contactNumber,
      payment_url:    paymentUrl,
    },
  });
});

module.exports = router;
