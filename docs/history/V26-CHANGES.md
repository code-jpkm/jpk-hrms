# JPK HRMS — v26.3

## What changed in v26.3

### Attendance machines: the simple way
The eSSL / ZKTeco machine now sends every punch to the HRMS by itself, using **ADMS / Cloud Server** mode, the same method as the Command Center.

You no longer need:
- bridge software that reads the machine;
- device IDs or tokens that must match by hand;
- a 5-minute sync.

**How it works**
1. **Add the machine.** Open **Attendance machines** (9-dot menu → Setup), type the machine's **serial number**, a name (e.g. "Office entrance"), the location, and the day from which punches count.
   - The serial number is on the machine under **M/OK → System Info → Device Info → Serial No.**, and on the sticker at the back.
   - Adding the machine is its approval.
2. **Connect it.** Type a few values into **Menu → COMM → Cloud Server Setting**, then restart the machine. The page shows the exact values, with copy buttons.
   - Within a minute the card changes from **Not connected yet** to **Connected**.
   - A machine that connects without being added first also appears, marked "waiting for approval". Click **Approve** to accept it.
3. **Link machine IDs to people.** The page lists every ID that punched, with the name stored on the machine.
   - Pick the employee once.
   - When the name on the machine clearly matches one employee, the page suggests the link, so it takes one click. **Link N suggested** links them all.
   - An ID that equals the employee code, or the employee's Device User ID, links automatically.
4. **Punches flow in by themselves, within seconds.**
   - The first punch of the day is the check-in and the last is the check-out.
   - Shifts, night shifts, late marks and LOP work exactly as before.
5. **The page stays live.** It shows each machine's state, the latest punches with what happened to each, and any IDs not linked yet.

**Getting from the machine to the HRMS.** Most eSSL machines only send plain `http`, and the HRMS on Render only accepts `https`. There are three ways, all explained on the page and in `machine-relay/README.md`:
- **Through an office computer** (works with every machine).
  - A tiny relay runs on any always-on computer in the same network. The computer needs Node.js and nothing else.
  - Download the two files from the page, then double-click `start-relay.bat`.
  - On the machine, set Enable Domain Name **OFF**, Server Address = that computer's IP, and Port **8081**. Your machine already uses port 8081 and Domain Name OFF.
- **Straight to the HRMS**, if the machine supports https: Domain Name **ON**, Server Address = the HRMS API address, Port **443**.
- **Cloudflare relay** (no computer needed), for the company domain: steps are in `machine-relay/cloudflare-worker.js`.

**For your machine (from the photos).** Its Cloud Server Setting is already ADMS with port 8081 and Domain Name OFF. Only the **Server Address** is missing: it is still 0.0.0.0.
- Using the office computer relay: enter the IP that the relay window shows.
- Using the straight or Cloudflare way: also fix Ethernet. DNS 0.0.0.0 can't look up names, so set **Gateway** to your router (usually 192.168.1.1), **DNS** to 8.8.8.8, and **Subnet Mask** to 255.255.255.0.

### Safety and correctness
- **New machines wait for approval.** Their punches are kept, not used. A machine that is not yours can be removed. At most 20 unknown machines can wait at once.
- **No lost punches.** If the HRMS can't save a batch, the machine is told to send it again. Punches sent twice are stored once.
- **Machine clock.** The machine sets its clock from the HRMS, with the India time zone sent to it. If its clock is still on UTC (5 h 30 min behind), new punches are corrected automatically and the machine card shows a warning.
- **Re-linking.** Linking an ID to a different person moves its punches. The previous person's days are worked out again.

### Fixes for every punch source (machine, bridge, manual import)
- **An approved correction is never overwritten.** A day fixed through regularization, or an HR override, is not changed by a punch that arrives later. Before, a late machine punch could overwrite it.
- **Double presses count once.** Pressing twice within 2 minutes is one punch. Before, the second press became a check-out a few seconds after the check-in. The window can be changed with `BIOMETRIC_DUPLICATE_MINUTES`.
- **Late-arriving punches are placed correctly.** A punch that arrives after a later one (machine was offline) becomes the check-in. Before, it was ignored.
- **Machine IDs with leading zeros match.** "0101" on the machine matches "101" in the HRMS.

### Files
- **New:**
  - `server/src/services/admsService.js`
  - `server/src/routes/admsRoutes.js` (the `/iclock/*` addresses the machine calls)
  - `machine-relay/` (relay, start files, Cloudflare Worker, README)
  - `client_fixed/src/styles/machines.css`
  - `client_fixed/public/downloads/attendance-relay.js`
- **Changed:**
  - `server/src/app.js`, `models/BiometricDevice.js`, `models/RawPunchLog.js`
  - `services/biometricService.js`, `controllers/biometricController.js`, `routes/biometricRoutes.js`
  - `jobs/scheduler.js`, `.env.example`
  - `client_fixed/src/pages/Biometric.jsx` (now **Attendance machines**; the bridge form is kept under "Older way")
  - `components/Icon.jsx`, `utils/nav.js`, `pages/Employees.jsx` (the field is now labelled "Machine ID")
- **Deploy:** redeploy both the server and the client. The `.env` files are untouched, and no new settings are required.

### How it was checked
- A simulated eSSL machine went through 37 checks, including adding a machine by serial number:
  - first contact, approval, the people list and stamps;
  - linking and suggestions, double presses, re-sent punches, start date;
  - re-linking, a kept correction, the UTC clock fix, junk input, removal;
  - `.aspx` addresses.
- The same requests also passed through the relay.
- API smoke tests: 69/69. The old bridge push was re-checked separately.
- Core attendance and payroll tests pass in UTC and IST.
- All pages were opened for three roles at desktop and phone width: no errors.
- Production build succeeds, with 0 lint errors.

---

# v26.2 (previous round)

## What changed in v26.2

### Your previous top menu is back
The large left menu from v26.1 is gone. The compact white top bar is back:

- **9-dot menu** (top left) opens every module, grouped (My work, People, Setup, Admin). Each module has a one-line hint, for example *Attendance correction — Fix a missed or wrong punch*. Type to filter; press Enter to open the first match.
- **JPK logo** (goes to Home).
- **Main links:** Home, Dashboard, People, Attendance, Leave, Payroll.
  - Each person only sees what they can open. An employee sees Home, My attendance, Leave and My payslips.
  - The link for the section you are in stays lit. For example, Attendance stays lit while you are on Attendance correction.
- **Right side:**
  - **Search** (Ctrl K) finds people, pages and actions.
  - **Notifications.**
  - **Gemini AI.**
  - **Settings menu:** My profile, Company settings, User access, Email/WhatsApp & AI, AI assistant, Sign out.
  - **Sign-out (power) button.**
- **On phones:**
  - The top row keeps the 9-dot menu, logo, search, notifications and settings.
  - The main links become a swipeable row underneath.

### Time-of-day scenery, like greytHR
- **Home** has a banner with a landscape behind your greeting, the time and the date, plus the Apply leave and Correct attendance buttons.
- **Every other page** has a slim header with the page name and where you are (for example *Home › People*) over the same landscape.
- **The scene follows the clock:**
  - **Dawn:** the sky turns peach and the sun comes up over the hills.
  - **Morning to afternoon:** the sun climbs across the sky and is bright, with rays, at midday. Clouds drift, birds fly and the plant chimney smokes.
  - **Evening:** the sun sets in orange, the moon rises, fireflies (jugnu) start to glow and the JPK plant's lights come on.
  - **Night:** dark sky, twinkling stars and the moon. Fireflies glow and the plant is lit, with a blinking light on the chimney.
- **Sunrise and sunset use the real times for Kolkata on each date.**
  - On 4 November: 5:42 am and 4:58 pm. On 21 June: about 4:52 am and 6:23 pm.
  - So it gets dark on screen when it gets dark outside.
  - For another site, set `VITE_SCENE_LAT` and `VITE_SCENE_LNG` in `client_fixed/.env`.
- **Colours** change minute by minute, so the scene never jumps. Only tints and shades of the logo navy, orange and grey are used.
- **Text colour** for the greeting and page names switches between navy and white automatically, so they stay readable over a light day sky or a dark night sky.
- **Motion** is slow and soft. It stops on devices set to *reduce motion*.
- **To preview any time of day,** add `?sceneAt=18:30` to the address, for example `/leave?sceneAt=05:50`.

### Fixes found while testing
- **Phones:** on Leave and some other pages, the help line under the page name took up a large empty space. Fixed.
- **Temporary server problems:** a restart, a network blip or "too many requests" used to show the sign-in page even though the session was fine. Now the app quietly retries a few times. If the server is still unreachable, it shows *Can't reach the HRMS server* with a **Try again** button, and the session is kept.

### Files
- **New:**
  - `client_fixed/src/components/DayScene.jsx` (the scenery)
  - `client_fixed/src/styles/scene.css`
  - `client_fixed/src/components/AppLauncher.jsx` (the 9-dot menu)
- **Changed:**
  - `components/Layout.jsx`
  - `pages/Home.jsx`
  - `utils/nav.js` (module hints)
  - `styles/theme.css`
  - `styles/home.css`
  - `state/AuthContext.jsx`
  - `App.jsx`
- **No server or database changes.** Only the client needs to be rebuilt and redeployed (`npm run build`). The `.env` files are untouched.

### How it was checked
- All 23 pages opened as Super Admin, manager and employee, at desktop size and at 390 px phone width:
  - no errors;
  - no sideways scrolling;
  - the page header appears on every page.
- Screenshots of the scene at dawn, morning, midday, afternoon, sunset, evening and night, on desktop and phone.
- API smoke tests: 69/69 pass.
- Attendance and payroll core tests pass in both the UTC and IST time zones.
- Production build succeeds, with 0 lint errors.

---

# v26.1 (previous round)

## What changed in v26.1

### New look, using only the JPK logo colours
The whole portal now uses three logo colours — navy `#1F3445`, orange `#F38121` and grey `#807F84` — plus their lighter and darker shades and white. Roughly 1,500 different colours were reduced to that palette.

- **Navy** is the working colour: text, buttons, selected items.
- **Orange** marks the one main action on a screen (Check in) and anything that needs attention (absent, late, missing punch).
- **Grey** covers everything secondary.

Other design changes:

- **Menu**
  - New left menu with your logo and plain labels: Home, Attendance, Leave, Attendance correction, Payroll, Holidays…
  - Each person only sees what they can open. The old 9-dot app grid and the top tab bar are gone.
  - On phones the menu slides out from the ☰ button.
- **Top bar**
  - Shows the page title, one search box, notifications and your profile menu.
  - Search finds **people** by name or employee code (and opens their profile), plus pages and common actions. Ctrl+K also opens it.
- **Home** is rebuilt as simple cards:
  - **Today**: your shift and a Check in / Check out button.
  - **Leave balance**.
  - **Waiting for your approval**, or **My pending requests** for employees.
  - **Upcoming holidays**.
  - **Team today**, for managers and HR.
  - **Quick links** and **Announcements**.
- **Attendance calendar** is now a calm month grid, like greytHR.
  - Each day shows a short code (P, A, HD, L, WFH, H, WO), the in–out time, and a small orange note when something needs attention (late, left early, missing punch, LOP).
  - Today is outlined in navy. The punch card is a white card with an orange Check in button.
- **Attendance correction** shows each day as one row with Date, Status, Shift, In, Out, Note and a **Fix** button.
- **Page tidy-up**
  - Big decorated banners were replaced by one line of plain help text and the page's buttons. The page title sits in the top bar.
  - Marketing headings ("Your whole team, beautifully organized.", "Payroll Command Center") and emoji labels were removed.
  - Fonts are lighter, corners smaller, shadows hairline, tabs underlined.
- **Sign-in page, emails, payslip and letter templates** use the JPK logo and colours.
- Everything was checked at desktop size and at 390 px phone width, with no sideways scrolling.

### Leave and corrections applied on someone's behalf are approved immediately
Before, a Super Admin's leave was auto-approved, but HR or a manager applying for an employee sent it back into their own approval inbox. Attendance corrections were never auto-approved.

Now, when someone who can approve the request applies for an employee, it is **recorded as approved on the spot**: Super Admin, HR, an `APPROVE` permission holder, or the employee's reporting manager.

- For leave, the balance is deducted and the attendance days are marked.
- For corrections, the punches are fixed and the day is recalculated.
- The employee is notified ("recorded for you by …").
- The form shows an **Approve now** box, ticked by default. Untick it to send the request to the manager instead.
- An employee applying for themselves still goes to their manager.
- The AI copilot uses the same rules.
- Managers can now also correct their own team's attendance.

### Other fixes this round
- Managers could see **Shifts, Organisation chart and Recruitment** in the menu, but the server refused them, so those pages showed errors. They now appear only for people who have that permission.
- Managers can open **Dashboard** from the menu.
- Drawers and pop-ups opened *under* the top bar, so their title and close button were hidden. Fixed.
- Profile, notice and recruitment dates showed in US format (e.g. 4/1/2023). They now show Indian dates (e.g. 01 Apr 2023).
- Employees' payslip page no longer shows admin wording.

To adjust colours later, edit one file: `client_fixed/src/styles/theme.css`. All colours are defined at the top.

---

# v26 (previous round)

Version 26 does four things:

1. Fixes the errors found in a full audit of v25.8.
2. Adds email and WhatsApp to every HR event that needs them.
3. Adds Gemini AI where it helps.
4. Redesigns the attendance portal and cleans up the screens that looked unfinished.

The React Native app and the three biometric bridge folders are unchanged. `package.json`, `server/.env` and `client_fixed/.env` are also exactly as you sent them.

---

## 1. Errors found and fixed

### Critical (wrong money, crashes, security)

| # | Where | What was wrong | Now |
|---|---|---|---|
| 1 | Payroll | `holidayDateKey` was used without being imported, so **payroll crashed for any month that has a holiday**. Most months have one. | Import fixed. Holidays are counted only if they are non-optional and apply to the employee's location (Office or Factory). |
| 2 | Payroll | Re-running a month that had already been **released** reset it to draft and rewrote the payslips employees had already received. | Blocked (409). A Super Admin can still force it, but must give a reason, which goes into the audit log. |
| 3 | Payroll | Re-running a month threw away earlier manual earning/deduction adjustments. | Adjustments are re-applied. |
| 4 | Payroll | People who joined after the month ended were still included. | Skipped. |
| 5 | Payroll | Employees could download **draft** payslip PDFs, and drafts could be emailed or sent on WhatsApp. | PDF returns 404 until the run is released. Sharing a draft needs an explicit "send anyway". |
| 6 | Payroll | Professional Tax was deducted even when gross pay was 0 (a full-LOP month). | Applied only when gross pay is above 0. |
| 7 | Biometric push | `?token[$ne]=x` matched any enabled device, so **anyone could push punches**. | Token compared as a plain string in constant time. Express query parser set to `simple`. |
| 8 | Employees | Bank account, Aadhaar and PAN went to every manager in the employee list. | Visible only to admins, people with EMPLOYEES:UPDATE, and the employee. |
| 9 | Employees / Recruitment | Request bodies were saved almost verbatim. Someone could move a record to another company (`tenantId`), set salary or probation on their own profile, or create a `SUPER_ADMIN` / allow-all login from a recruitment "convert to employee". | Every write goes through a field whitelist plus the account-guard rules. A Super Admin can no longer be demoted or disabled through those screens. |
| 10 | Holidays | `repair-dates` (rewrites every holiday) was open to any signed-in employee. | Holiday managers only. |
| 11 | Document templates | Preview was open to everyone and rendered any employee's data, payslips included. Any user could issue every letter type for themselves. | Preview: designers only. Issuing: HR / DOCUMENTS:CREATE within scope. Employees can self-serve payslips only. |
| 12 | Company settings | `COMPANY_SETTINGS` was missing from the audit enum, so every save returned a 500 error *after* it had already been saved. | Fixed. Audit writes can no longer fail a successful save. |
| 13 | Errors | Database validation, cast and duplicate errors all came back as "500 Server error" with a stack trace. Render never sets `NODE_ENV=production`, so the trace was visible. | Mapped to 400/409 with a readable message. Stack traces stay in server logs only. |

### Time zone (Render runs on UTC, the company runs on IST)

| # | What was wrong | Now |
|---|---|---|
| 14 | A correction request for **10:00** was saved as 10:00 UTC, which displays as **15:30 IST**. HR overrides and the AI "regularize" command had the same bug. | Times without a zone are read as IST. The browser now sends `+05:30`. |
| 15 | "Today" was calculated in UTC on the dashboard, attendance calendar, HR assistant and greetings. Until 05:30 IST each day they showed **yesterday**. | Everything uses the company calendar day. The server process is pinned to UTC (`HRMS_SERVER_TZ`) so it behaves the same on a laptop and on Render. |
| 16 | Scheduled jobs ran on server time, so the 08:30 birthday wishes went out at 2 pm IST and the "1st of the month 00:10" leave accrual ran at 5:40 am. | Jobs run on `HRMS_TIMEZONE` (Asia/Kolkata). |
| 17 | Missing-check-in alerts went out on weekly offs and at the exact minute a shift started. | Weekly offs are skipped. Alerts wait one hour after shift start. |
| 18 | A shift assignment saved without a start date was never picked up, so "permanent" shifts silently did nothing. | Start date defaults to today and is validated. |

### Leave, attendance, probation

| # | What was wrong | Now |
|---|---|---|
| 19 | Leave accepted a "to" date before the "from" date (negative days), multi-day half-days and overlapping requests. The balance check ignored requests already pending, so balances could be over-booked. Approvers could approve their own leave. | All validated. Balance is checked against approved + pending days and re-checked at approval. No self-approval. |
| 20 | Leave could not be withdrawn or cancelled. | Pending requests: the employee or approver can withdraw. Approved requests: HR can cancel with a reason, which returns the balance and restores attendance. |
| 21 | Regularization allowed future dates, duplicate pending requests, check-out before check-in, and self-approval. | All blocked. |
| 22 | A very short day (e.g. 3 hours) was marked HALF_DAY, but the project's own core test expected ABSENT. | Now a policy setting: Attendance Rules → step 5, "Very short days". Defaults to HALF_DAY so nothing changes until you choose. |
| 23 | Probation: a confirmed review could later be "extended". Extension months were not checked (0, negative or text crashed). Managers could decide their own probation. "31 Jan + 1 month" became 3 March. "Run reminders now" ran for every company. | All fixed. The employee is now told by email, WhatsApp and in-app when they are confirmed or extended. |
| 24 | Probation hook: **every save** of an employee with a joining date put them back on probation, including staff who joined years ago. That stopped their monthly EL accrual and triggered daily manager reminders. | Runs only when the dates actually change. |
| 25 | Managers got probation reminders linking to `/probation`, then saw **"Access denied"** on that page. | Managers can open it, scoped to their team. |
| 26 | HR assistant: a name with regex characters (e.g. "C++") broke the search. | Escaped. |
| 27 | Employee and candidate codes were `count + 1`, so deleting any earlier record made every later create fail with a duplicate-key error. | Atomic per-company counter. |
| 28 | Excel import read dates as US `m/d/yy` text, so 05/04 could become May 4 instead of 5 April. | Read from the Excel date value. Letters print Indian dates (e.g. 12 Aug 2026). |
| 29 | Dashboard layouts never saved: the app called `/dashboard/layout`, which didn't exist (a 404 on every visit). | Routes added. Customised dashboards follow the user to any device. |
| 30 | Dashboard "Present today" ignored half-days. | Counts anyone who checked in. |
| 31 | The AI page read Gemini status only from `.env` and showed the wrong model. | Reads the same settings the AI features use. |

### Front end

- **Icons showed as empty boxes** across many screens because their names were missing from the icon map. 154 icons are now mapped.
- **Stale data:** `useApi` didn't refetch when the employee or month changed, and a slow old response could overwrite a newer one.
- **Unexpected sign-outs:** any failed request (network, 500) logged the user out. Only 401/403 does that now.
- **Home:**
  - The shortcuts column overflowed under the notice board and cut off the "Review" links.
  - Employees saw admin shortcuts ("Run Payroll", "Add Employee") and "leave approvals" counters.
- **Account:** the name in the header was dark text on a dark background. Dates showed in US format.
- **Recruitment:** KPI boxes read "0Total Applicants". Funnel bars showed even at 0.
- **Payroll:** section headers ran the label and title together on one line.
- **Notice Board:** the warning text ran together, and "Cloudinary not configured" was shown in green.
- **AI page:** the model chip was white on white.
- **Holidays:** cards hid the holiday name under the location pill.
- **Phones:** several pages scrolled sideways at 390 px (Leave, Attendance team view), and tab rows pushed the page wider.
- **Regularization:** week-offs and future days showed punches as "Missing".

### Deployment

- `server/package-lock.json` pointed all 267 packages at a private mirror (`packages.applied-caas-gateway1.internal…`) that Render can't reach. They now point at the public npm registry, with the same versions.

---

## 2. Email and WhatsApp everywhere

Admins set this up in **Company Settings → Integrations** (or `.env`; values saved in the app take priority).

- **Email providers:** Brevo, Resend, SendGrid or SMTP.
  > **Render free plan:** outbound SMTP (ports 25/465/587) has been blocked since September 2025. Gmail/SMTP will time out there, so use **Brevo** (300 free emails a day), Resend or SendGrid. They send over HTTPS.
- **WhatsApp providers:** Maytapi (your `.env` already has it, so it switches on by itself) or Meta WhatsApp Cloud API (approved templates are mapped per event).
- **Delivery:** every message goes through a persistent outbox, with retries, de-duplication, a delivery log, a retry button and a test send for each channel.
- **Notification rules:** a matrix of each event against email, WhatsApp and in-app.

| Event | Who gets it |
|---|---|
| Leave applied / decided / cancelled | Approver / employee |
| Regularization & permission submitted / decided | Approver / employee |
| Payslip released (PDF attached) · Payroll generated | Employee · HR |
| Portal invite | New employee |
| Notice published (per-notice channel switches) | Audience |
| Birthday & work-anniversary wishes (automatic 08:30 + one-click from Celebrations) | Employee |
| Celebrations digest, holiday reminder (day before), daily HR digest | HR / everyone |
| Probation due (manager + HR) · **Probation confirmed/extended** (employee) | — |
| Candidate stage updates & letters | Candidate |
| Missing check-in alert | Employee |
| **Letter issued** (PDF attached; also filed in the employee's documents) | Employee |
| Message Center broadcast | Everyone / Office / Factory / departments / chosen people |

New screens:

- **Message Center:** write once and send by email, WhatsApp and in-app, with a live phone and inbox preview.
- **Celebrations:** birthdays and anniversaries, with "Send wishes" that Gemini can write.
- **Employees → Documents → Issue a letter:** uses any live Document Studio template. You can download it, or email the PDF and/or WhatsApp a link.

## 3. Gemini AI

Gemini runs where it adds value. Every feature uses only the records the signed-in user is allowed to see. The API key goes in a request header, not the URL. Each request also sends `store=false`, so Google does not keep a log of the HR data. This matters because Google now logs requests by default for paid projects created on or after 26 Oct 2026. You can allow logging in Integrations → Gemini AI. If Gemini isn't configured, every feature still works using rule-based summaries.

| Where | What it does |
|---|---|
| Dashboard | Morning briefing: your team or your day, with what to focus on |
| Attendance → Insights | Patterns, risks and suggestions for one person or the team |
| Leave approval inbox | Balance after approval, overlaps in the team, history, suggested decision |
| Payroll | Pre-release review of the run (anomalies, LOP spikes) · "Explain my payslip" |
| Notices / Message Center | Draft from a one-line brief, polish, translate to **Hindi / Bengali** |
| Celebrations | Personal birthday and anniversary wishes |
| Recruitment | Job description writer · candidate fit score (strengths, gaps, interview questions) |
| Probation | Draft review from attendance, leave and the manager's notes, plus decision remarks |
| AI Copilot & HR assistant | Natural-language commands (existing, now uses the Integrations key) |
| Daily HR digest | Short summary emailed to HR |

Default model: `gemini-flash-latest`. If that fails, it falls back to `gemini-3.8-flash`, then `gemini-3.5-flash-lite`, then `gemini-2.5-flash`. Usage per feature is shown in Integrations → Gemini AI.

## 4. Design

- **Attendance portal** (rebuilt):
  - Live IST clock and punch card with a worked-time ring.
  - Month calendar with in/out times, worked bar and late / early / missing / LOP flags.
  - Day drawer with a shift-vs-actual timeline and a one-click correction request (HR can correct directly).
  - KPI strip.
  - **Team today** board with filters, CSV export and "Remind N people not in yet" on WhatsApp/email.
  - Insights charts.
- **Dashboard:** a "Today" row with the Gemini briefing, team attendance (who isn't in yet) or your own month, and the next 7 days of birthdays, anniversaries and holidays. Quick actions match the user's role.
- **Probation:** redesigned with due/overdue counts, filters, a review panel, the AI draft, and confirm/extend.
- **Integrations, Message Center, Celebrations:** new.
- **Leave, Payroll, Notices, Recruitment, Company Settings, Home, Account:** the fixes listed above.

---

## 5. After you deploy — setup steps

1. **Rotate the secrets that were inside the zip.** `server/.env` was included, with the MongoDB password, `JWT_SECRET`, Gemini key, Maytapi token, Cloudinary secret and Google client IDs. Anyone with the zip has them.
   - Change them in MongoDB Atlas, Google AI Studio, Maytapi and Cloudinary.
   - Set the new values in Render's Environment tab rather than committing `.env`.
2. **Set `INTEGRATIONS_SECRET`** on Render to a long random value **before** saving any keys in the Integrations screen. It encrypts saved credentials. If it isn't set, `JWT_SECRET` is used, and rotating `JWT_SECRET` later would mean re-entering those keys.
3. **Email:**
   - Create a Brevo account and verify your sender (e.g. `hr@jpkm.in`).
   - In Integrations → Email choose **Brevo**, paste the API key, then click **Send test**.
4. **WhatsApp:** already set up through Maytapi in `.env`. Open Integrations → WhatsApp → **Send test** to your own number.
5. **Gemini:** your `.env` key is used automatically. You can replace it in Integrations → Gemini AI and click **Test**.
6. **Holidays:** open Holidays and click **Check saved dates** once. This re-saves holidays created by older versions on the canonical day. The app reads both forms correctly anyway.
7. **Attendance Rules → step 5:** choose whether very short days count as **Half day** (current behaviour) or **Absent**.
8. Optional:
   - Review Integrations → **Notification rules** and turn off anything you don't want on WhatsApp.
   - For the Meta Cloud API, create the templates listed there in WhatsApp Manager.

New optional server variables are documented in `server/.env.example`:

- `HRMS_SERVER_TZ`
- `TRUST_PROXY_HOPS`
- `RATE_LIMIT_PER_MINUTE`
- `DISABLE_OUTBOX_WORKER`
- `EXPOSE_ERROR_STACK`
- the `EMAIL_*` / `WHATSAPP_*` / `GEMINI_*` keys

## 6. How it was checked

- **API:** 69 checks against a local test database covering:
  - payroll in holiday months, draft and released guards;
  - leave validation, cancel and balance restore;
  - IST time handling;
  - team-today and celebrations;
  - integrations and broadcast preview;
  - AI fallbacks and scope checks;
  - probation guards;
  - dashboard layouts;
  - letter issue & send;
  - on-behalf leave and corrections (auto-approved for HR and managers, pending for employees and when "send for approval" is chosen).

  All pass.
- **Core logic tests:** pass under both the UTC and Asia/Kolkata time zones.
- **Lint and build:** 0 lint errors on server and client, and the production `vite build` succeeds.
- **Screens:** every page was opened as Super Admin, Manager and Employee at desktop size and at 390 px phone width. There were no runtime errors and no sideways scrolling.

**Not tested live:**

- I did not send real email or WhatsApp messages or call Gemini, because I did not use your credentials. With no provider configured, the outbox marks messages SKIPPED, as designed.
- I never connected to your production database.
