'use strict';

module.exports = (sequelize, DataTypes) => {
  const PollResponse = sequelize.define(
    'PollResponse',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      poll_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'polls',
          key: 'id',
        },
      },
      // Nullable on purpose. When a member erases their account, their
      // past votes stay and this becomes NULL — the `zone` snapshot below
      // is what every count actually reads, so the kitchen's historical
      // numbers are unaffected by the person disappearing.
      user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      // The user's primary vote, cast during the voting window (10PM–10AM).
      response: {
        type: DataTypes.ENUM('yes', 'no'),
        allowNull: false,
      },
      // Snapshot of the user's zone at vote time. Stored here so that even
      // if the user's zone changes later, the kitchen count stays accurate.
      zone: {
        // The zone's stable key (locations.zone_key), snapshotted at vote
        // time. A plain string, not an enum: the community can add zones,
        // and a retired zone's past votes must still read correctly.
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      // --- Special case fields (10AM–5PM window) ---

      // True when the user submits a special case during the 10AM–5PM window.
      is_special_case: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      // 'want'      = originally voted No, now wants food
      // 'dont_want' = originally voted Yes, no longer wants food
      // Null when is_special_case is false.
      special_case_type: {
        type: DataTypes.ENUM('want', 'dont_want'),
        allowNull: true,
      },
      // Exact timestamp when the special case was submitted.
      special_case_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Super admin decision on the special case (5–6PM allotment window).
      // Null = not yet reviewed. 'approved' / 'rejected' set by super admin.
      sehri_allowed: {
        type: DataTypes.ENUM('approved', 'rejected'),
        allowNull: true,
      },

      // ---- Live delivery ETA (during the delivery window) ------------
      // Updated by etaComputationService as the assigned rider's
      // location comes in. Null when the rider hasn't started, when
      // the destination has no coordinates, or when a Distance Matrix
      // call fails.
      current_eta_minutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      current_eta_updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Set the first time we send a "rider arriving in ~5 min"
      // notification for this delivery. Prevents duplicate pushes as
      // the ETA ticks around the threshold.
      proximity_notified_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'poll_responses',
      indexes: [
        // One response per user per poll — enforced at DB level.
        { unique: true, fields: ['poll_id', 'user_id'] },
        { fields: ['poll_id'] },
        { fields: ['user_id'] },
        // Zone-grouped aggregation queries use this heavily.
        { fields: ['poll_id', 'zone'] },
        // Super admin special-cases list filters on this.
        { fields: ['poll_id', 'is_special_case'] },
      ],
    }
  );

  PollResponse.associate = (models) => {
    PollResponse.belongsTo(models.Poll, {
      foreignKey: 'poll_id',
      as: 'poll',
    });
    PollResponse.belongsTo(models.User, {
      foreignKey: 'user_id',
      as: 'user',
    });
  };

  return PollResponse;
};
