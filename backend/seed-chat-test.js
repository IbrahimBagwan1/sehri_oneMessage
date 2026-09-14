'use strict';

/**
 * seed-chat-test.js — Chat feature test seed
 *
 * What this does:
 *   1. Finds the existing super admin in DB
 *   2. Finds or creates 2 test users (from the poll seed — reuses same phones)
 *   3. Finds or creates 1 test admin
 *   4. Prints UUIDs and tokens ready to paste into curl commands
 *
 * Run:  node seed-chat-test.js
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./src/models');
const { signAccessToken } = require('./src/utils/jwt');

const { User, Admin, SuperAdmin, Location } = db;

async function seed() {
  try {
    await db.sequelize.authenticate();
    console.log('✅ DB connected\n');

    // ── 1. Find super admin ─────────────────────────────────────────────────
    const superAdmin = await SuperAdmin.findOne();
    if (!superAdmin) {
      console.error('❌ No super_admin found. Create one first via POST /api/admin/create-super-admin');
      process.exit(1);
    }
    console.log(`✅ Super admin: ${superAdmin.name} (${superAdmin.id})`);

    // ── 2. Find the poll test users (created by seed-poll-test.js) ──────────
    const userPhones = ['9200000001', '9200000002'];
    const users = await User.findAll({ where: { phone: userPhones } });

    if (users.length < 2) {
      console.error('❌ Test users not found. Run  node seed-poll-test.js  first.');
      process.exit(1);
    }
    console.log(`✅ Found ${users.length} test users`);

    // ── 3. Find or create a test admin ──────────────────────────────────────
    let testAdmin = await Admin.findOne({ where: { phone: '9300000001' } });
    if (!testAdmin) {
      // Find any zone-type location to assign
      const zoneLocation = await Location.findOne({ where: { type: 'zone' } });
      if (!zoneLocation) {
        console.error('❌ No zone location found in DB. Run migrations + seeders first.');
        process.exit(1);
      }
      const password = await bcrypt.hash('test1234', 10);
      testAdmin = await Admin.create({
        name: 'Chat Test Admin',
        phone: '9300000001',
        password,
        zone_location_id: zoneLocation.id,
        is_active: true,
      });
      console.log(`✅ Created test admin: ${testAdmin.name}`);
    } else {
      console.log(`✅ Found test admin: ${testAdmin.name}`);
    }

    // ── 4. Generate tokens ───────────────────────────────────────────────────
    const saToken   = signAccessToken({ id: superAdmin.id, role: 'super_admin' });
    const adminToken = signAccessToken({ id: testAdmin.id, role: 'admin', zone_location_id: testAdmin.zone_location_id });
    const user1Token = signAccessToken({ id: users[0].id, role: 'user' });
    const user2Token = signAccessToken({ id: users[1].id, role: 'user' });

    // ── 5. Print everything ──────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════════════════');
    console.log('  SEED COMPLETE — paste these into your curl commands');
    console.log('════════════════════════════════════════════════════\n');

    console.log('# IDs');
    console.log(`SA_ID="${superAdmin.id}"`);
    console.log(`ADMIN_ID="${testAdmin.id}"`);
    console.log(`USER1_ID="${users[0].id}"   # ${users[0].name}`);
    console.log(`USER2_ID="${users[1].id}"   # ${users[1].name}`);
    console.log('');
    console.log('# Tokens');
    console.log(`SA_TOKEN="${saToken}"`);
    console.log(`ADMIN_TOKEN="${adminToken}"`);
    console.log(`USER1_TOKEN="${user1Token}"`);
    console.log(`USER2_TOKEN="${user2Token}"`);
    console.log('\n════════════════════════════════════════════════════\n');

    await db.sequelize.close();
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    console.error(err.stack);
    await db.sequelize.close();
    process.exit(1);
  }
}

seed();
