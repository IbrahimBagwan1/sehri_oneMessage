'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const { resolveZone } = require('../utils/resolveZone');
const logger = require('../utils/logger');
const zoneRegistry = require('../services/zoneRegistry');
const notificationService = require('../services/notificationService');
const { describeMember } = require('../utils/memberDisplay');
const {
  getPollPhase,
  isVotingOpen,
  overrideOf,
  PHASES,
} = require('../utils/pollPhase');
const pollCalendar = require('../services/pollCalendar');

const { Poll, PollResponse, User } = db;

/**
 * The poll as clients see it. `is_active` is the EFFECTIVE state — is
 * voting open right now — which is what every screen actually wants to
 * know; the stored three-state override is reported separately so the
 * super admin can see whether a manual decision is in force.
 */
const shapePoll = (poll, phase = getPollPhase(poll)) => ({
  id: poll.id,
  date: poll.date,
  question: poll.question,
  is_active: phase === PHASES.VOTING,
  override: overrideOf(poll) === true ? 'forced_open' : overrideOf(poll) === false ? 'forced_closed' : null,
});

// ---------------------------------------------------------------------------
// Shared helper — the poll members are currently looking at. From 22:00 IST
// that is tomorrow's poll once it has been opened; see services/pollCalendar.
// ---------------------------------------------------------------------------
const getTodaysPoll = () => pollCalendar.getCurrentPoll();

// ---------------------------------------------------------------------------
// GET /api/polls/active
// Access: any authenticated user, admin, super_admin
//
// Returns today's poll plus the current phase so the mobile client knows
// which UI state to render without doing its own time math.
// ---------------------------------------------------------------------------
const getActivePoll = async (req, res, next) => {
  try {
    const poll = await getTodaysPoll();

    if (!poll) {
      return success(res, {
        statusCode: 200,
        message: 'No poll scheduled for today',
        data: { poll: null, phase: PHASES.CLOSED },
      });
    }

    const phase = getPollPhase(poll);

    // Attach the calling user's own response for today so the home screen
    // can show "You voted: Yes" and switch into the special-case UI branch
    // without a second request.
    //
    // NOTE: this route intentionally uses `verifyToken` alone (no
    // requireUserAccess) so admins/super_admins with no linked users row
    // can still fetch phase. That means req.actingUserId is NOT populated
    // for us — we have to derive it inline from the JWT payload, mirroring
    // the requireUserAccess middleware's rule:
    //   • role='user'      → id IS the users.id
    //   • role='admin'|'super_admin' → user_id (if linked; else null → skip)
    // Without this derivation, my_response used to always come back null
    // for regular users, breaking the post-vote UI refresh AND the
    // special-case UI branch (which both key off my_response).
    const actingUserId =
      req.auth?.role === 'user'
        ? req.auth.id
        : req.auth?.user_id || null;

    let myResponse = null;
    if (actingUserId) {
      myResponse = await PollResponse.findOne({
        where: { poll_id: poll.id, user_id: actingUserId },
        attributes: ['response', 'is_special_case', 'special_case_type', 'sehri_allowed'],
      });
    }

    return success(res, {
      statusCode: 200,
      message: 'Active poll fetched',
      data: {
        poll: shapePoll(poll, phase),
        phase,
        my_response: myResponse,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/polls/:id/respond
// Body: { response: 'yes' | 'no' }
// Access: approved users only
//
// Rules:
// • Voting window must be open (10 PM – 10 AM IST).
// • A user may vote only once per poll — duplicate returns 409.
// • Zone is snapshotted from the user's current location_id at vote time.
// ---------------------------------------------------------------------------
const submitVote = async (req, res, next) => {
  try {
    const { id: pollId } = req.params;
    const { response: vote } = req.body;

    // 1. Load the poll
    const poll = await Poll.findByPk(pollId);
    if (!poll) {
      return error(res, { statusCode: 404, message: 'Poll not found' });
    }

    // 2. Check the voting window
    if (!isVotingOpen(poll)) {
      return error(res, {
        statusCode: 403,
        message: 'Voting window is not open',
      });
    }

    // 3. Prevent duplicate votes
    const existing = await PollResponse.findOne({
      where: { poll_id: pollId, user_id: req.actingUserId },
    });
    if (existing) {
      return error(res, {
        statusCode: 409,
        message: 'You have already voted on this poll',
      });
    }

    // 4. Resolve the user's zone from their location_id.
    //    Zone is stored as a snapshot so kitchen counts remain accurate
    //    even if the user changes zone later.
    const user = await User.findByPk(req.actingUserId, {
      attributes: ['location_id'],
    });
    if (!user) {
      return error(res, { statusCode: 404, message: 'User not found' });
    }

    const zoneLocation = await resolveZone(user.location_id, db);
    if (!zoneLocation) {
      return error(res, {
        statusCode: 422,
        message: 'Could not resolve your zone from your registered location',
      });
    }

    // The zone's own stable key, read off the row rather than re-derived
    // from its display name. Slugifying the name here is what used to make
    // "Girls Accommodation" (-> girls_accommodation) fail validation against
    // a list that held `girls`, so nobody in that zone could vote.
    const zoneName = zoneLocation.zone_key;
    if (!zoneName) {
      return error(res, {
        statusCode: 422,
        message:
          `Zone "${zoneLocation.name}" has not been set up for voting yet. `
          + 'Ask a super admin to check the zone settings.',
      });
    }

    // 5. Create the response. The unique (poll_id, user_id) index is the
    // real guard: two taps racing past the check above both reach here, and
    // the loser gets the same 409 as a second vote rather than a 500.
    let pollResponse;
    try {
      pollResponse = await PollResponse.create({
        poll_id: pollId,
        user_id: req.actingUserId,
        response: vote,
        zone: zoneName,
      });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        return error(res, { statusCode: 409, message: 'You have already voted on this poll' });
      }
      throw err;
    }

    return success(res, {
      statusCode: 201,
      message: 'Vote submitted successfully',
      data: {
        id: pollResponse.id,
        response: pollResponse.response,
        zone: pollResponse.zone,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/polls/my-responses
// Access: authenticated users
//
// Returns the calling user's full vote history across all polls, newest first.
// Useful for the "Poll History" screen.
// ---------------------------------------------------------------------------
const getMyResponses = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const { count, rows } = await PollResponse.findAndCountAll({
      where: { user_id: req.actingUserId },
      include: [
        {
          model: Poll,
          as: 'poll',
          attributes: ['id', 'date', 'question'],
        },
      ],
      attributes: [
        'id',
        'response',
        'zone',
        'is_special_case',
        'special_case_type',
        'sehri_allowed',
        'created_at',
      ],
      order: [[{ model: Poll, as: 'poll' }, 'date', 'DESC']],
      limit,
      offset,
    });

    return success(res, {
      statusCode: 200,
      message: 'Vote history fetched',
      data: {
        total: count,
        page,
        limit,
        responses: rows,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/polls/active/stats
// Access: admin, super_admin
//
// Returns a zone-by-zone breakdown of today's votes.
// Used by the admin dashboard to know how many meals to prepare per zone.
// ---------------------------------------------------------------------------
const getActiveStats = async (req, res, next) => {
  try {
    const poll = await getTodaysPoll();

    if (!poll) {
      return success(res, {
        statusCode: 200,
        message: 'No poll scheduled for today',
        data: { poll: null, stats: null },
      });
    }

    // Determine which zones this caller is allowed to see:
    //   • super_admin → every zone
    //   • admin       → only their own zone (resolved from their JWT's
    //                    zone_location_id, then mapped to the zone-name
    //                    key used in poll_responses.zone)
    //
    // Mirrors the same restriction getZoneVoters already enforces —
    // without it, a zone admin saw every zone's vote totals, breaking
    // the "you only see your own zone" invariant applied everywhere
    // else in the admin surface (users list, feedback list, etc.).
    let allowedZones = await zoneRegistry.zoneKeys();
    let adminZoneName = null;
    if (req.auth.role === 'admin') {
      const adminZoneLocation = await resolveZone(req.auth.zone_location_id, db);
      if (!adminZoneLocation) {
        return error(res, {
          statusCode: 422,
          message: 'Could not resolve your admin zone',
        });
      }
      adminZoneName = adminZoneLocation.zone_key;
      if (!adminZoneName) {
        return error(res, {
          statusCode: 422,
          message: `Your zone "${adminZoneLocation.name}" has not been set up for voting yet.`,
        });
      }
      allowedZones = [adminZoneName];
    }

    // Aggregate yes/no counts per zone in one query using GROUP BY.
    // sequelize.fn + sequelize.col lets us do COUNT(*) without raw SQL.
    const { sequelize } = db;

    const where = { poll_id: poll.id };
    if (adminZoneName) where.zone = adminZoneName;

    const rows = await PollResponse.findAll({
      where,
      attributes: [
        'zone',
        'response',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: ['zone', 'response'],
      raw: true,
    });

    // Shape the raw rows into a clean zone-keyed map — but ONLY include
    // the zones this caller is allowed to see.
    const stats = Object.fromEntries(
      allowedZones.map((z) => [z, { yes: 0, no: 0, total: 0 }])
    );

    for (const row of rows) {
      if (stats[row.zone]) {
        stats[row.zone][row.response] = parseInt(row.count, 10);
      }
    }

    // Compute totals per zone
    for (const zone of allowedZones) {
      stats[zone].total = stats[zone].yes + stats[zone].no;
    }

    // Grand totals across the zones this caller can see.
    const grandTotal = {
      yes:   allowedZones.reduce((s, z) => s + stats[z].yes, 0),
      no:    allowedZones.reduce((s, z) => s + stats[z].no, 0),
      total: allowedZones.reduce((s, z) => s + stats[z].total, 0),
    };

    return success(res, {
      statusCode: 200,
      message: 'Poll stats fetched',
      data: {
        poll: shapePoll(poll),
        phase: getPollPhase(poll),
        by_zone: stats,
        grand_total: grandTotal,
        // The admin's own zone name, so the frontend can gate the
        // drill-down affordance to just this zone without a second
        // /me call. Null for super_admin (they see everything).
        my_zone: adminZoneName,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/polls/:id/zone-voters
// Query param: ?zone=masjid  (optional — defaults to the calling admin's zone)
// Access: admin, super_admin
//
// Returns the names of users who voted 'yes' in a specific zone for a given
// poll. Admins see only their own zone unless they are super_admin.
// ---------------------------------------------------------------------------
const getZoneVoters = async (req, res, next) => {
  try {
    const { id: pollId } = req.params;

    // Determine which zone to query.
    // - super_admin may pass ?zone=<name> or omits it to get all zones.
    // - admin is restricted to their own zone (resolved from zone_location_id
    //   on their token, then resolved to a zone name via resolveZone).
    let targetZone = req.query.zone || null;

    if (req.auth.role === 'admin') {
      // Admin's token carries zone_location_id — resolve it to a zone name.
      const adminZoneLocation = await resolveZone(req.auth.zone_location_id, db);
      if (!adminZoneLocation) {
        return error(res, {
          statusCode: 422,
          message: 'Could not resolve your admin zone',
        });
      }
      // The zone's stable key, exactly as votes store it. Slugifying the
      // display name here (as this used to) meant an admin of "Girls
      // Accommodation" asked for `girls_accommodation`, which never matched
      // the stored key, and saw an empty list or a 403.
      const adminZoneName = adminZoneLocation.zone_key;
      if (!adminZoneName) {
        return error(res, {
          statusCode: 422,
          message: `Your zone "${adminZoneLocation.name}" has not been set up for voting yet.`,
        });
      }

      // If the admin tried to pass a different zone, reject it.
      if (targetZone && targetZone !== adminZoneName) {
        return error(res, {
          statusCode: 403,
          message: 'You can only view voters in your own zone',
        });
      }
      targetZone = adminZoneName;
    }

    // Validate zone value if provided
    if (targetZone && !(await zoneRegistry.isValidZoneKey(targetZone))) {
      const known = await zoneRegistry.zoneKeys();
      return error(res, {
        statusCode: 400,
        message: `Invalid zone '${targetZone}'. Must be one of: ${known.join(', ')}`,
      });
    }

    const poll = await Poll.findByPk(pollId);
    if (!poll) {
      return error(res, { statusCode: 404, message: 'Poll not found' });
    }

    // ?response=yes (default) | no | all
    //
    // Default stays 'yes' so the existing admin drill-down ("Yes voters")
    // is unchanged. Super admins reviewing turnout need to see who said
    // no as well, so 'all' is available — the caller decides.
    const responseFilter = (req.query.response || 'yes').toLowerCase();
    if (!['yes', 'no', 'all'].includes(responseFilter)) {
      return error(res, {
        statusCode: 400,
        message: "response must be one of: 'yes', 'no', 'all'",
      });
    }

    // Build the where clause
    const where = { poll_id: pollId };
    if (responseFilter !== 'all') where.response = responseFilter;
    if (targetZone) {
      where.zone = targetZone;
    }

    const responses = await PollResponse.findAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone'],
        },
      ],
      // created_at is the moment the vote was cast — the super admin
      // needs it to audit turnout ("who voted and when"). special_case_at
      // is the moment they later changed their mind, which is a
      // different and equally useful timestamp.
      attributes: [
        'id',
        'zone',
        'response',
        'is_special_case',
        'special_case_type',
        'special_case_at',
        'sehri_allowed',
        'created_at',
      ],
      // Newest vote first within each zone so the drill-down reads as a
      // chronological feed rather than arbitrary insertion order.
      order: [['zone', 'ASC'], ['created_at', 'DESC']],
    });

    // Group by zone for cleaner consumption by the admin UI
    const grouped = {};
    let yesCount = 0;
    let noCount  = 0;
    for (const r of responses) {
      const z = r.zone;
      if (!grouped[z]) grouped[z] = [];
      if (r.response === 'yes') yesCount += 1;
      else if (r.response === 'no') noCount += 1;
      grouped[z].push({
        response_id: r.id,
        response: r.response,
        is_special_case: r.is_special_case,
        special_case_type: r.special_case_type,
        special_case_at: r.special_case_at,
        sehri_allowed: r.sehri_allowed,
        voted_at: r.created_at,
        // Votes cast by members who have since erased their account keep
        // counting (that is the point of the zone snapshot) but carry no
        // identity — see utils/memberDisplay.js.
        user: describeMember(r.user, ['id', 'name', 'phone']),
      });
    }

    return success(res, {
      statusCode: 200,
      message: 'Zone voters fetched',
      data: {
        poll: { id: poll.id, date: poll.date },
        zone: targetZone || 'all',
        response_filter: responseFilter,
        voters: grouped,
        total_yes: yesCount,
        total_no: noCount,
        total: responses.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/polls/create-today
// Access: super_admin
//
// Manually creates today's poll — the safety net for the (documented but
// unimplemented) daily cron job. Idempotent: if today's poll already exists,
// returns 409 with the existing row rather than silently duplicating.
//
// `is_active` defaults ON when we're currently inside the scheduled voting
// window (22:00–09:59 IST) so opening it during the vote window immediately
// lets users vote. Outside that window it stays OFF and the phase engine
// resolves to SPECIAL_CASE/ALLOTMENT/STATUS based on the clock. The super
// admin can flip is_active any time via PATCH /active/toggle.
// ---------------------------------------------------------------------------
const createTodaysPoll = async (req, res, next) => {
  try {
    // The poll a super admin opens now: today's before 22:00 IST,
    // tomorrow's from 22:00 — when tomorrow's voting window opens. Before
    // this, creating at 22:00 hit today's existing poll (409), so voting
    // could not actually start until after midnight.
    const pollDate = pollCalendar.creationDateFor();

    const existing = await Poll.findOne({ where: { date: pollDate } });
    if (existing) {
      return error(res, {
        statusCode: 409,
        message: `The poll for ${pollDate} already exists.`,
        code: 'POLL_EXISTS',
      });
    }

    // is_active stays NULL: the schedule decides when voting opens and
    // closes. Writing TRUE here (as before) read as a manual extension, so
    // voting never closed at 10:00 on its own. See utils/pollPhase.js.
    let poll;
    try {
      poll = await Poll.create({ date: pollDate, is_active: null });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        return error(res, { statusCode: 409, message: `The poll for ${pollDate} already exists.`, code: 'POLL_EXISTS' });
      }
      throw err;
    }
    const phase = getPollPhase(poll);
    pollCalendar.invalidateDeliveryPoll();

    logger.info(`[polls] super_admin=${req.auth.id} created poll ${poll.id} for ${pollDate} (phase=${phase})`);

    // Tell the community the poll is open — only if it actually is. This is
    // the only code path that creates a poll (there is no scheduler), and
    // the unique index on polls.date means it can succeed once per date, so
    // the notification cannot double-fire even with several instances.
    if (phase === PHASES.VOTING) {
      notificationService.notifyInBackground(
        () => notificationService.sendToAll({
          title: 'Sehri poll is open',
          body: 'Let the kitchen know whether you need Sehri tomorrow.',
          data: { type: 'poll_open', poll_id: poll.id, route: '/(user)' },
        }),
        'poll opened'
      );
    }

    return success(res, {
      statusCode: 201,
      message: `Poll for ${pollDate} created`,
      data: {
        poll: shapePoll(poll, phase),
        phase,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getTodaysPoll, // exported so Person 2 handlers can import it
  shapePoll,
  getActivePoll,
  submitVote,
  getMyResponses,
  getActiveStats,
  getZoneVoters,
  createTodaysPoll,
};
