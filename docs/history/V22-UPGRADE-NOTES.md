# JPK HRMS v22 — Attendance Correctness + Premium UX Upgrade

## Critical attendance correction

The `321 min early leave` example was caused by a timezone mismatch: an India punch such as **18:09 IST** can be represented internally as **12:39 UTC**. The older rule engine was comparing that UTC timestamp directly against an `18:00` local shift clock, which falsely produced 321 minutes of early leave and 0.5 LOP.

v22 now treats shift start/end as company-local clock times and converts them into real UTC instants using the attendance-policy timezone offset. For JPK / India, use **+330 minutes (IST)**.

A `10:00–18:00` shift with `09:56` check-in and `18:09` check-out therefore evaluates as:

- Late: `0 min`
- Early leave: `0 min`
- Physical status: `PRESENT`
- LOP: `0`, unless a separate explicit HR override/rule applies

v22 also guards against stale `fullDayMinutes` values after a shift is edited. If the shift clock is changed to a shorter duty window, an old duration threshold cannot incorrectly keep the employee at HALF_DAY.

### Historical shift changes now recalculate attendance

When HR changes/assigns a shift for a past date, the server re-evaluates existing attendance records for the selected employee/date range from the stored check-in/check-out pair. The Attendance calendar also self-heals complete biometric/mobile attendance rows when a month is opened, so records calculated by the old timezone logic are corrected without deleting punch data.

## Operation feedback — React Hot Toast

`react-hot-toast` is now installed at the application level. All normal POST / PATCH / PUT / DELETE requests made through the shared API client show a clear success or failure toast. Background notification polling/read-state operations deliberately suppress toasts so the UI does not become noisy.

## Leave / WFH workflow

- Reporting managers can apply leave for employees in their reporting hierarchy.
- Super Admin and HR can apply on behalf within their configured scope.
- Super Admin-applied leave is auto-approved immediately; no second approval is required.
- **WFH is opt-in only.** An employee sees WFH only when `canApplyWfh = true` has been explicitly enabled by an authorized admin.
- Paid leave types with zero available balance are hidden from the request dropdown.
- **LOP / Unpaid Leave is always available** and does not consume EL / CL / SL / Comp-Off balances.
- Applying or deciding leave creates in-app notifications for the relevant manager/employee.

Existing employees that pre-date the new WFH permission are not guessed or deleted. Safe seed flags the missing field for Super Admin review; it does not create dummy employees.

## Notifications

A new Notification Center is available from the top navigation with unread counts, mark-read controls and links to the relevant HR workflow.

Events currently include:

- New leave / WFH requests
- Leave approval / rejection
- New attendance regularization / permission requests
- Attendance regularization / permission decisions
- Payroll generation checkpoint reminders
- Payroll generation summary for HR/Admin
- Salary-slip-ready notifications for employees

Users can also enable browser alerts. Browser Notification API alerts work while the HRMS is open (including a background tab) and browser permission has been granted. True closed-browser VAPID/service-worker push requires production web-push credentials and subscription infrastructure and is not falsely represented as enabled by default.

## Employee Directory v22

The employee directory has been redesigned as a premium people directory:

- Profile photo support (Cloudinary-backed employee PHOTO document)
- Google profile picture fallback
- Initials fallback
- Green presence dot for recently active users
- `Online now`, `Last active Xm ago`, `Yesterday`, etc.
- Workplace chips for Office / Factory / Both
- Department, designation, employee code and role visible on cards
- Responsive cards and premium profile banner
- Existing employee editing, salary, document, Excel import and profile-review workflows remain available

Presence is driven by authenticated activity. A lightweight server heartbeat updates `lastSeenAt` without delaying normal requests.

## Homepage / visual system

The homepage scenery was rebuilt as a transparent watercolor-style city illustration inspired by the supplied reference: coral/pink distant buildings, magenta/aubergine foreground skyline, soft clouds and a right-side sun on a clean white canvas. The palette changes automatically for morning, midday, afternoon, evening and night using the user's local browser time.

The top navigation, home panels, leave workflow, employee directory, attendance drawer and mobile breakpoints received v22 premium UI overrides for a more compact, high-end and responsive experience.

## Safe seed

`npm run seed` remains a **non-destructive migration seed**:

- Does not delete employees
- Does not delete attendance, leave, payroll or salary data
- Does not add dummy employee records
- Preserves existing HR configuration instead of overwriting it
- Flags only missing new employee fields for Super Admin review
- Migration version is now `22`

## Environment

India/JPK timezone:

```env
HRMS_TIMEZONE_OFFSET_MINUTES=330
```

Cloudinary:

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Gemini continues to use the existing Gemini environment configuration in the server.

## Installation after extracting

Frontend dependencies changed because `react-hot-toast` was added. The old frontend `package-lock.json` was intentionally not shipped because it no longer represented the dependency graph. In `client_fixed`, run:

```bash
npm install
npm run dev
```

Backend:

```bash
cd server
npm install
npm run seed
npm run dev
```

Use the safe seed after deploying the updated server so existing employee records are reviewed/migrated without being deleted.

## Validation performed in the build workspace

- Backend JavaScript syntax check: PASS
- Core attendance/payroll logic tests: PASS
- Specific IST regression test for `10:00–18:00`, checkout `18:09 IST`: PASS
- Regression test for stale full-day threshold after shift edit: PASS
- Frontend JS/JSX parsing: PASS (41 files)
- CSS brace structure: PASS
- Server package JSON / lock JSON: PASS

A full Vite production bundle was not claimed because frontend packages were not installed in the sandbox. Run `npm install` in `client_fixed` before `npm run build` in the deployment environment.
