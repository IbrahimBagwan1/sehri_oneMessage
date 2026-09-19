'use strict';

/**
 * Creates the donations table.
 *
 * A resident submits a donation via POST /api/donations/submit. Admins in
 * the same zone (or any super_admin) review it and set status to
 * 'verified' or 'rejected'. verified_by references the admins table.
 *
 * Amount is stored as DECIMAL(10,2) so we get exact INR rupees + paise
 * without any FP rounding surprises.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('donations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        // Do not cascade delete — soft-deleted users keep their donations
        // for audit purposes.
        onDelete: 'RESTRICT',
      },
      amount: {
        // Rupees + paise. Max 10 digits (up to 99,999,999.99 = ~10 crore).
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      note: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('pending', 'verified', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      },
      // admin.id of the verifier (any admin or super_admin who linked to
      // an admin row). Nullable until reviewed.
      verified_by: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      verified_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('donations', ['user_id']);
    await queryInterface.addIndex('donations', ['status']);
    await queryInterface.addIndex('donations', ['created_at']);
    await queryInterface.addIndex('donations', ['user_id', 'created_at']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('donations');
  },
};
