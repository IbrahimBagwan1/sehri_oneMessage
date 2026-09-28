// payment.js — behaviour for payment.html.
//
// Served as a separate file rather than an inline <script> because the API's
// Content-Security-Policy (helmet's default, script-src 'self') blocks inline
// scripts. Inline, neither the live number fetch nor the Copy button ran.
'use strict';

// The number is fetched from the same-origin /api/payment/info endpoint
// so the operator can rotate it without a redeploy. Falls back to the
// placeholder if the fetch fails.
(async function () {
  const el = document.getElementById('contact-number');
  try {
    const res = await fetch('/api/payment/info');
    if (res.ok) {
      const body = await res.json();
      if (body && body.data && body.data.contact_number) {
        el.textContent = body.data.contact_number;
      }
    }
  } catch (_) { /* ignore — fallback text stays */ }
})();

// Copy handler — normalizes to the 10-digit local number (drops +91
// and any formatting) so pasting into a UPI app is dial-clean.
document.getElementById('copy-btn').addEventListener('click', async function () {
  const hint = document.getElementById('copy-hint');
  const el = document.getElementById('contact-number');
  const digits = el.textContent.replace(/\D/g, '');
  const text = (digits.length === 12 && digits.indexOf('91') === 0) ? digits.slice(2) : digits;
  try {
    await navigator.clipboard.writeText(text);
    hint.textContent = 'Copied to clipboard';
  } catch (_) {
    // Fallback for browsers without the async clipboard API.
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); hint.textContent = 'Copied to clipboard'; }
    catch { hint.textContent = 'Long-press the number to copy manually.'; }
    document.body.removeChild(ta);
  }
  setTimeout(function () { hint.innerHTML = '&nbsp;'; }, 3000);
});
