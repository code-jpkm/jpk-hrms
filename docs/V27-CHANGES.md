# v27.0 — Next.js app, password + captcha sign-in (16 Nov 2026)

## One Next.js project
- Website moved from Vite + react-router to **Next.js 16 App Router**: one route
  folder per page under `app/`, shared frame in `app/(portal)/layout.jsx`.
- Screens kept as they were (`ui/views`), loaded per page (code splitting) and
  rendered in the browser (they use the session in localStorage).
- `ui/lib/router.jsx`: the pages' Link / NavLink / useNavigate / useLocation /
  useSearchParams / Navigate now run on Next.js navigation (hash deep links like
  `/attendance#team` included).
- The v26.3 Express API runs in the same process (`server.js` custom server):
  `/api/*`, `/iclock/*`, `/health` → API; everything else → Next.js.
- One `package.json`, one `.env`, one deploy. The API is called at `/api` on the
  same address; CORS always allows the app's own pages.
- `/permissions` redirects to `/regularization` (next.config redirects).
- Production start refuses to run without `JWT_SECRET`.

## Sign-in: password + picture captcha (Google removed)
- Removed everywhere: Google button, Google script, `/api/auth/google`,
  `google-auth-library`, Google fields / index handling, "Google invitation".
- New: `GET /api/auth/captcha`, `POST /api/auth/login` (email or employee code),
  `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`,
  `POST /api/auth/change-password`.
- Captcha: `server/src/services/captchaService.js` (svg-captcha, signed single-use
  token, 5 minutes, dark letters, look-alike characters left out).
- Lockout: 5 wrong passwords → 15 minutes (`LOGIN_LOCK_AFTER`, `LOGIN_LOCK_MINUTES`).
  Failed sign-ins limited per network (`LOGIN_FAILURES_PER_15_MIN`).
- Temporary passwords: `server/src/services/loginAccessService.js`. HR
  "Send login details" (one person or everyone without a password), new
  employees and recruitment joiners. Shown once to HR; must be changed at first
  sign-in (API blocks other pages until then).
- Sessions: tokens older than the last password change are refused.
- Messages: `ACCESS_INVITE` now carries the temporary password; new
  `PASSWORD_RESET`. Both are `sensitive`: the text is removed from the history
  once handled, hidden in Message Center, and cannot be re-sent from there.
- First start: `ADMIN_EMAIL` + `ADMIN_PASSWORD` give the Super Admin a password
  (only while it has none). `npm run seed` accepts `SEED_ADMIN_PASSWORD`.

## Screens
- Sign-in, forgot password, reset password and "choose your own password" on
  the live time-of-day landscape.
- My profile → **Sign-in & password** (change password, last sign-in).
- People → login state on each profile, **🔑 Send login details**, and
  **Send login details to N without a password** with a CSV of the ones to hand over.
- Recruitment → joiner's temporary password shown once.

## Files
- New: `app/**`, `server.js`, `server/src/start.js`, `next.config.mjs`,
  `jsconfig.json`, `ui/lib/router.jsx`, `ui/next/*`, `ui/components/auth/*`,
  `ui/views/{Login,ForgotPassword,ResetPassword,SetPassword}.jsx`,
  `ui/styles/login.css`, `server/src/services/{captchaService,loginAccessService}.js`.
- Changed: auth controller / routes / middleware, User model, env, db, seed,
  employee + recruitment controllers, account guard, messaging events /
  dispatcher / outbox, notification + integration log endpoints, app.js (CORS,
  build v27.0), Layout, Dashboard (`?studio=1`), Employees, Account, Recruitment,
  API client, AuthContext.
- Removed: `client_fixed/` (now `app/` + `ui/`), `server/package.json`,
  `server/src/server.js`, `index.html`, Vite.

## Tests
Sign-in 58/58 · API smoke 69/69 · attendance machines 37/37 · core logic (UTC + IST) ·
all pages × 3 roles × desktop/phone clean · browser walk-through 24/24.
