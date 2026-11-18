# JPK HRMS v27 — one Next.js app

The whole HRMS (website, API and attendance machines) is now **one Next.js
project**. One folder, one GitHub repo, one Render service.

- **Website**: Next.js 16 (App Router) + React 19 — `app/` (pages) and `ui/` (screens).
- **API**: the tested v26.3 Express API runs inside the same server — `server/`.
  `/api/*`, `/iclock/*` (attendance machines) and `/health` go to it; everything
  else is a website page.
- **Sign-in**: email (or employee code) + password + picture captcha.
  **Google sign-in is removed** (website and API).

## Folders

| Folder | What is in it |
| --- | --- |
| `app/` | Next.js routes: one folder per page (`/employees`, `/attendance`, `/login`, …) |
| `ui/` | The screens (`ui/views`), shared parts (`ui/components`), styles |
| `server/` | The API: models, routes, controllers, services, scheduled jobs |
| `server.js` | Starts everything: Next.js + API + scheduled jobs + email/WhatsApp outbox |
| `public/` | Logo, favicon, the attendance-relay download |
| `tools/` | Office tools: attendance-machine relay, older biometric bridges |
| `docs/` | Change notes (`V27-CHANGES.md`, older notes in `docs/history`) |

## Run on your computer

Needs Node.js 20.9 or newer and a MongoDB (your Atlas address works).

```bash
cp .env.example .env      # then fill MONGO_URI and JWT_SECRET
npm install
npm run dev               # http://localhost:3000
```

Production mode: `npm run build` then `npm start`.

## Put it on Render (one Web Service)

1. Push this folder to a GitHub repo.
2. Render → **New → Web Service** → pick the repo.
   - **Build command**: `npm install && npm run build`
   - **Start command**: `npm start`
3. **Environment**: copy the settings from your current API service
   (`MONGO_URI`, `JWT_SECRET`, Gemini, email, WhatsApp, Cloudinary…) and add:
   - `NODE_ENV` = `production`
   - `ADMIN_EMAIL` = your Super Admin email, `ADMIN_PASSWORD` = a first password
     (see "First sign-in" below)
   - `APP_URL` only if you use your own domain (e.g. `https://hr.jpkm.in`)
   - Remove `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_IDS` (no longer used).
4. Deploy. Open `https://<your-service>.onrender.com/health`: it shows `"build":"v27.0"`.

The website and the API now share one address, so the separate website upload
(`dist` folder) is no longer needed.

## First sign-in after switching from Google

Logins made for Google sign-in have **no password yet**.

1. Set `ADMIN_EMAIL` + `ADMIN_PASSWORD` on the server and deploy / restart.
2. Sign in with them. The app asks you to choose your own password straight away.
3. Remove `ADMIN_PASSWORD` from the server settings (it only ever applies while
   that login has no password, unless `ADMIN_PASSWORD_RESET=true`).
4. **People** → **"Send login details to N without a password"**: everyone gets
   a temporary password by email / WhatsApp. Anyone the message cannot reach is
   listed with their temporary password (download as CSV) so you can hand it over.
   Each person must choose their own password at first sign-in.

One person: open their profile → **🔑 Send login details**.
New employees and new joiners from Recruitment get login details automatically.
Forgot password: the sign-in page sends a reset link (email + WhatsApp, 30 minutes).

## Sign-in security

- Picture captcha on sign-in and forgot-password (built in, no keys or accounts).
  Each picture works once and expires in 5 minutes; letters are drawn as shapes,
  not text.
- 5 wrong passwords pause that login for 15 minutes; failed sign-ins per network
  are limited too (a whole office signing in at 9:00 is never blocked).
- Passwords: at least 8 characters, letters and numbers, must not contain the email.
  Stored as bcrypt hashes.
- Temporary passwords and reset links are removed from the message history once
  handled and never shown there.
- Changing a password (or new login details from HR) signs out every other device.
- The same answer for "wrong email" and "wrong password" (no hint which one).

## Attendance machines

Same as v26.3, but the address is now the app's address. On the machine
(Cloud Server / ADMS): Domain ON, `<your-service>.onrender.com`, port 443 — or
use the office relay (`tools/machine-relay`, `APP_URL` = the app's address).

## Mobile app

The mobile app (`hrms-mobile-v25.8.2-google-login-fixed`) only had Google
sign-in, which this server no longer accepts. It needs an update (email +
password + captcha) before it can sign in again.

## Tests run for v27 (local test database)

- Sign-in: 58 checks (captcha, lockout, temporary passwords, reset links, Google
  removal, history masking, CORS, machine endpoints)
- API smoke: 69/69 · attendance machines: 37/37 · core payroll/attendance logic
  (UTC and IST)
- Every page for Super Admin, Manager and Employee at desktop and phone width
- Browser walk-through of sign-in, first password, HR login details, forgot /
  reset password, change password: 24/24
