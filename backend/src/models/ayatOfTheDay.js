'use strict';

module.exports = (sequelize, DataTypes) => {
  const AyatOfTheDay = sequelize.define(
    'AyatOfTheDay',
    {
      // UTC calendar date, YYYY-MM-DD. The primary key, not a surrogate id:
      // one verse per day is the invariant, and making the date the key is
      // what lets two concurrent cache misses resolve to a single upstream
      // call — see services/ayatService.js.
      date: {
        type: DataTypes.STRING(10),
        allowNull: false,
        primaryKey: true,
      },
      // islamic.app's `data` object, verbatim. NOT a verse we chose: the
      // selection is entirely theirs, deterministic per UTC date, and the
      // same for every caller worldwide. Unrelated to quran_chapters /
      // quran_verses, which hold the full corpus synced by
      // services/islamicApiSync.js.
      payload: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      fetched_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'ayat_of_the_day',
      indexes: [{ fields: ['fetched_at'] }],
    }
  );

  return AyatOfTheDay;
};
