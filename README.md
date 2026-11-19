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
| `tools/` | Office tools: attendance-machine relays (Cloudflare and office computer), older biometric bridges |
| `android-app/` | The Android app (React Native / Expo, JS only). Not part of the website build; see `android-app/README.md` |
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

Open **Attendance machines** (9-dot menu → Setup), add the machine by its serial
number and follow the steps on its card. Most eSSL machines (for example the
X2008) can only send plain http, and Render only accepts https, so they go
through a relay:

- **Through Cloudflare (free, recommended):** the page gives the relay code with
  this server's address filled in. Deploy it as a free Cloudflare Worker, save its
  `*.workers.dev` address on the page (it is checked), and type that address into
  the machine (Domain ON, port 80). Details: `tools/machine-relay/README.md`.
- **Through an office computer:** `tools/machine-relay` on an always-on computer.
- **Straight to the HRMS** (Domain ON, port 443) works only on machines with https.

The machine also needs Subnet Mask 255.255.255.0, Gateway = the router and
DNS 8.8.8.8 (Menu → COMM → Ethernet).

## Mobile app

`android-app/` holds the Android app for v27 (email or employee code + password +
captcha, phone check-in, attendance, leave, payslips, approvals). It points at
https://jpk-hrms.onrender.com. Build the APK with Expo EAS: see `android-app/README.md`.

## Live weather on the scenery

The landscape on the home page, the page headers and the sign-in pages follows
the real weather: clouds gather and the sun dims, rain or snow falls, lightning
flashes in a storm, fog lies on the hills and a poor AQI shows as brown haze.
The home greeting shows the temperature in °C, the AQI on India's CPCB scale
and a short tip; click it for humidity, wind, rain chance and PM2.5 / PM10.

- Data: Open-Meteo (weather) and Copernicus CAMS (air), no key needed. The free
  plan is for non-commercial use; with a paid plan set `OPEN_METEO_API_KEY`.
- Where: the browser's location, asked once and rounded to about 5 km, else the
  employee's office or factory site (Company settings → sites), else Kolkata.
  Sign-in pages show the main office.
- The server caches each 5 km square (10 min weather, 30 min air). Free cloud
  servers share their internet address, and Open-Meteo sometimes refuses it the
  forecast; then each browser asks Open-Meteo itself (the answer's `nowError`
  says why the server could not).
- Preview: add `?sceneWeather=rain` (clear, partly, cloudy, fog, drizzle, rain,
  heavy, storm, snow) and `?sceneAqi=320` to any address; `?sceneAt=20:30` sets the time.
- Check after a deploy: `https://jpk-hrms.onrender.com/api/weather/office`.

## Tests run for v27 (local test database)

- Sign-in: 58 checks (captcha, lockout, temporary passwords, reset links, Google
  removal, history masking, CORS, machine endpoints)
- API smoke: 69/69 · attendance machines: 37/37 · core payroll/attendance logic
  (UTC and IST)
- Every page for Super Admin, Manager and Employee at desktop and phone width
- Browser walk-through of sign-in, first password, HR login details, forgot /
  reset password, change password: 24/24
