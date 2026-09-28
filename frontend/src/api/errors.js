/**
 * errors.js — one plain-language sentence for any failed request.
 *
 * Screens used to show the server's message or a generic "Couldn't load…",
 * which reads the same whether the phone is offline, the connection timed
 * out, or the server broke — and only one of those is fixed by the member
 * moving to better signal. This tells them which it is.
 *
 * @param {unknown} err      the axios error
 * @param {string} fallback  what the screen would have said otherwise
 */
export const describeError = (err, fallback = 'Something went wrong. Try again in a moment.') => {
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
    return 'The connection is slow and the request timed out. Try again when you have better signal.';
  }
  if (!err?.response) {
    return "You're offline or the server can't be reached. Check your connection and try again.";
  }
  const { status, data } = err.response;
  if (status >= 500) return 'The server is having a problem. Try again in a moment.';
  return data?.message || fallback;
};

/** "Saved copy from 4:12 am" for content served from the offline cache. */
export const savedCopyLabel = (offline) => {
  if (!offline?.savedAt) return null;
  const when = new Date(offline.savedAt).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  });
  return `You're offline — showing the copy saved ${when}.`;
};
