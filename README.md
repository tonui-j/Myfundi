MYFUNDI - Node.js + Express
===========================

This project now runs with a Node.js/Express backend and MySQL.
Frontend pages are static HTML/CSS/JS served by Express.

Run
---
1. Install dependencies:
   `npm install`
2. Optional: copy `.env.example` to `.env` and adjust DB/session values.
3. Start server:
   `npm start`
4. Open:
   `http://localhost:8000`

API routes (Express)
--------------------
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/session`
- `GET /api/auth/profile`
- `GET /api/auth/logout`
- `POST /api/bookings`
- `POST /api/workers/verify`

Notes
-----
- MySQL bootstrap and seed logic is in `node/db.js`.
- Express server is in `node/server.js`.
- `admin.html` is protected by Node session middleware (`/admin` and `/admin.html`).
- This repository is now pure Node.js/Express for backend APIs (no PHP runtime files).
