# OneMessage API

Express 5 + Sequelize (MySQL) + Socket.IO. See the [root README](../README.md)
for endpoints, setup, the security model and tests, and
[`docs/release/`](../docs/release/) for store submission.

```bash
npm install
cp .env.example .env   # validated on boot
npm run migrate
npm run dev
npm test               # needs a <DB_NAME>_test database — see tests/run.js
```
