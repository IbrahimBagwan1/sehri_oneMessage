'use strict';

/**
 * pollCalendar.js — which poll row "now" refers to.
 *
 * There are two different questions, and they have different answers for a
 * couple of hours every night, which is why this file exists.
 *
 * 1. THE CURRENT POLL — the one members see on the home screen and vote on.
 *    Voting for date D opens at 22:00 on D−1, so from 22:00 onwards the
 *    current poll is tomorrow's if a super admin has opened it, and today's
 *    (now in its read-only STATUS phase) until they do.
 *
 * 2. THE DELIVERY POLL — the one whose stops riders are working through.
 *    That is today's poll, EXCEPT in the small hours: a run that starts in
 *    the evening of D can still be out on the road after midnight, and at
 *    00:30 the calendar says D+1. Keying strictly on the calendar made a
 *    rider's remaining stops, and every resident's tracking screen, vanish
 *    at the stroke of midnight. So before 10:00 — by which point any Sehri
 *    run is over — yesterday's poll stays the delivery poll while it still
 *    has pending stops and today's has none yet.
 *
 * Both are computed in IST via utils/istTime.js.
 */

const db = require('../models');
const { istDateString, istHour, addDays } = require('../utils/istTime');
const { WINDOWS } = require('../utils/pollPhase');

const { Poll, DeliveryStop } = db;

/** Date of the poll a super admin opens if they tap "create" right now. */
const creationDateFor = (now = new Date()) => {
  const today = istDateString(now);
  return istHour(now) >= WINDOWS.VOTING_OPEN_HOUR ? addDays(today, 1) : today;
};

/** The poll members see and vote on. */
const getCurrentPoll = async (now = new Date(), { transaction } = {}) => {
  const today = istDateString(now);
  if (istHour(now) >= WINDOWS.VOTING_OPEN_HOUR) {
    const next = await Poll.findOne({ where: { date: addDays(today, 1) }, transaction });
    if (next) return next;
  }
  return Poll.findOne({ where: { date: today }, transaction });
};

// The delivery poll is read on every rider GPS push, so the decision (not the
// row — rows are re-read so they are never stale) is cached briefly.
const DELIVERY_CACHE_MS = 30 * 1000;
let deliveryCache = { key: null, pollId: null, at: 0 };

const invalidateDeliveryPoll = () => { deliveryCache = { key: null, pollId: null, at: 0 }; };

const resolveDeliveryPollId = async (now) => {
  const today = istDateString(now);
  const todays = await Poll.findOne({ where: { date: today }, attributes: ['id'] });

  if (istHour(now) < WINDOWS.VOTING_CLOSE_HOUR) {
    const yesterday = await Poll.findOne({ where: { date: addDays(today, -1) }, attributes: ['id'] });
    if (yesterday) {
      const [pendingYesterday, stopsToday] = await Promise.all([
        DeliveryStop.count({ where: { poll_id: yesterday.id, status: 'pending' } }),
        todays ? DeliveryStop.count({ where: { poll_id: todays.id } }) : 0,
      ]);
      if (pendingYesterday > 0 && stopsToday === 0) return yesterday.id;
    }
  }
  return todays ? todays.id : null;
};

/** The poll whose delivery run is in progress (or next up). */
const getDeliveryPoll = async (now = new Date()) => {
  const key = `${istDateString(now)}:${istHour(now) < WINDOWS.VOTING_CLOSE_HOUR ? 'am' : 'day'}`;
  const fresh = deliveryCache.key === key && Date.now() - deliveryCache.at < DELIVERY_CACHE_MS;
  const pollId = fresh ? deliveryCache.pollId : await resolveDeliveryPollId(now);
  // "No poll yet" is never cached: the moment a super admin creates one,
  // riders and residents must see it, not 30 seconds later.
  if (!fresh && pollId) deliveryCache = { key, pollId, at: Date.now() };
  return pollId ? Poll.findByPk(pollId) : null;
};

module.exports = {
  creationDateFor,
  getCurrentPoll,
  getDeliveryPoll,
  invalidateDeliveryPoll,
};
