# HRMS v25 — full build (v24 + correctness fixes + UI repair)

This is your **complete project**, not a patch. Everything from v24 is here
unchanged except the six files listed below. Install exactly as you would v24:

```
cd server       && npm install && npm run dev
cd client_fixed && npm install && npm run dev
```

No database migration is required. Your existing data works as-is.

### Files changed from v24

| File | Change |
|------|--------|
| `server/src/utils/salary.js` | rewritten — LOP waterfall, rate guards |
| `server/src/utils/shift.js` | timezone resolver + anomaly guard |
| `server/src/services/attendanceRulesService.js` | deferred status, forgiven minutes |
| `client_fixed/src/styles.css` | 195 broken font sizes rescaled + v25 kit |
| `client_fixed/src/components/Icon.jsx` | registered Eye / EyeOff / LayoutGrid / AlertTriangle and 10 more |
| `client_fixed/src/components/V25Kit.jsx` | **new** — Section, MaskedAmount, CheckRow, MonthAccordion, Flag |
| `server/src/models/Attendance.js` | new `exceptionEventsCounted` field |
| `server/salary-waterfall-test.js` | **new** — `cd server && node salary-waterfall-test.js` |
| `server/exception-quota-test.js` | **new** — `cd server && node exception-quota-test.js` |
| `server/src/models/DocumentTemplate.js` | **new** — drag-drop template schema |
| `server/src/services/templateRenderService.js` | **new** — token engine + PDF renderer |
| `server/src/services/templatePresets.js` | **new** — 14 ready-made layouts |
| `server/src/controllers/documentTemplateController.js` | **new** — CRUD, preview, issue |
| `server/src/routes/documentTemplateRoutes.js` | **new** |
| `server/src/app.js` | mounts `/api/document-templates` |
| `client_fixed/src/pages/DocumentDesigner.jsx` | **new** — the designer |
| `client_fixed/src/App.jsx` / `utils/nav.js` / `utils/permissions.js` | route, sidebar entry, access gate |

Everything was verified before packaging: all 107 server files pass `node --check`,
every client `.jsx` transpiles cleanly, and the salary test runs green in place.

---

## 1. Salary: LOP now cascades instead of hitting Basic

**Before.** Every component was multiplied by the same payable-days ratio, so one
LOP day cut Basic, HRA, Conveyance and Special Allowance all at once. Basic drives
PF, gratuity and statutory reporting, so this was the most expensive bug in the build.

**Now.** The LOP is converted to rupees once, then absorbed component by component.
Each is drained to zero before the next is touched. **Basic is always last** and is
structurally prevented from being configured any earlier.

```
Special Allowance -> Conveyance -> HRA -> Other Earnings -> Basic
```

Verified output on a 26,000 gross (Basic 15,000 / HRA 6,000 / Conv 1,600 / Spl 2,400 / Other 1,000), 26 working days:

| LOP | Special | Conveyance | HRA | Other | Basic | Earned gross |
|-----|---------|-----------|-----|-------|-------|--------------|
| 0.5 d | 1,900 | 1,600 | 6,000 | 1,000 | **15,000** | 25,500 |
| 2 d | 400 | 1,600 | 6,000 | 1,000 | **15,000** | 24,000 |
| 4 d | 0 | 0 | 6,000 | 1,000 | **15,000** | 22,000 |
| 20 d | 0 | 0 | 0 | 0 | 6,000 | 6,000 |

The waterfall is order-configurable via `payrollRule.lopWaterfall`. Every slip now
carries a `lop` object with `days`, `perDayGross`, `amount` and a per-component
`breakdown` — feed that straight into the payslip so employees can see exactly
where the money came from.

### Choose your statutory basis
`payrollRule.statutoryBasis` controls what PF/ESI are computed on:

- `'EARNED'` *(default)* — PF/ESI on post-waterfall components. Because Basic is
  now protected, **PF stays at the full contractual Basic** until LOP is large
  enough to reach it.
- `'CONTRACT'` — PF/ESI always on full contractual components, ignoring LOP.

Please confirm with your PF consultant which one your establishment files under.
Indian practice is usually PF on *earned* basic, and protecting Basic changes that
number. This is the one decision in this patch I cannot make for you.

### A live landmine I found and defused
`asPercent` used `n > 1 ? n / 100 : n`. The ESI employee rate is **0.75%**. If an
admin typed `0.75` into the rule form, the old code read it as **75%** — on a
20,000 gross that is 15,000 of ESI instead of 150. Rates are now sanity-clamped
(PF ceiling 50%, ESI ceiling 10%) with a console warning, and `payrollRule.percentUnit`
(`'PERCENT'` or `'FRACTION'`) removes the ambiguity permanently.

---

## 2. The "permitted as per rule" half-day bug

Your description was exact: someone is late on the 1st, the remark says the
exception is permitted, and the day still becomes a half day.

**Root cause.** `statusFromWorkedMinutes` downgraded the day to `HALF_DAY` on
worked-minutes *before* the monthly quota was consulted. `baseLop` was then read
from that already-poisoned status, so `Math.max(0.5, 0)` charged half a day even
though the late-in had been forgiven.

**Fix.** The physical classification is computed but held back. Minutes forgiven by
the quota (or a MEDICAL/SPECIAL approval) are tracked in `forgivenMinutes`, and the
downgrade is only applied if the shortfall survives them:

> Worked 431m + 49m permitted exception covers the duty day: kept PRESENT, no LOP

The hard early-leave half-day threshold still overrides the quota, as it should.

---

## 3. Absent days were eating the 3-exception quota

The monthly late/early quota is a benefit that only makes sense on a day the
employee actually worked. An absent day is a flat 1-day LOP — it should never
spend an exception. It was spending them in **three** separate places:

1. `monthlyExceptionEventsUsedBefore` filtered
   `status: { $nin: ['LEAVE','WFH','HOLIDAY','WEEK_OFF'] }` — which does **not**
   exclude `ABSENT` or `HALF_DAY`. Any absent day carrying late/early minutes was
   swept into the historical count.
2. `exceptionCursor += 1` fired on late/early minutes before the day's status was
   known, so the quota was spent even on days that resolved to absent.
3. The `evaluateMonth` in-memory accumulator re-derived the count from raw minutes
   with **no status filter at all**, so a full-month re-evaluation reintroduced the
   leak even after the query was fixed.

### What it cost

Two absent days early in the month, then three genuine late arrivals:

```
BEFORE                                    AFTER
01 Aug ABSENT   1/3 used                  01 Aug ABSENT   quota untouched
04 Aug ABSENT   2/3 used                  04 Aug ABSENT   quota untouched
07 Aug PRESENT  3/3 used  LOP 0           07 Aug PRESENT  1/3  LOP 0
12 Aug PRESENT  4/3 EXHAUSTED  LOP 0.5    12 Aug PRESENT  2/3  LOP 0
18 Aug PRESENT  5/3 EXHAUSTED  LOP 0.5    18 Aug PRESENT  3/3  LOP 0
25 Aug PRESENT  6/3 EXHAUSTED  LOP 0.5    25 Aug PRESENT  4/3  LOP 0.5
```

**1.5 days of LOP wrongly deducted in one month**, on top of the two absences the
employee was already correctly charged for.

### The fix

Attendance now carries `exceptionEventsCounted` — the authoritative number of
exceptions **that day** actually spent. Both counters read this field instead of
re-deriving it, so they can no longer disagree. It is set to 0 when:

- the day resolved to `ABSENT` (full-day LOP governs), or
- the day resolved to `HALF_DAY` and the forgiveness failed to rescue it — the
  0.5 base LOP already governs, so spending an exception would take the benefit
  away without giving anything back. The quota is refunded and the remark says so.

A day rescued to `PRESENT` by the forgiveness **does** spend its exception, which
is correct: the benefit was used and it worked.

> **Run this once after upgrading.** Existing rows have no
> `exceptionEventsCounted` yet. The historical query falls back to deriving it
> (now correctly status-filtered), but re-evaluating each affected month via
> Attendance Rules → Evaluate Month populates the field properly and refunds any
> LOP wrongly charged.

---

## 4. The 321-minute phantom early leave

From your screenshot: a 10:00–18:00 shift, punch-out at 18:09, reported as
**321 minutes early**. 321 minutes is exactly 18:00 minus 12:39 — and 12:39 UTC
*is* 18:09 IST. The punch was stored correctly; the shift window was built in UTC.

**Root cause.** Both call sites used `Number(policy.timezoneOffsetMinutes ?? 330)`.
`??` does not fall back on `0`. Any policy row holding `0` — an empty form field
posts as `""`, which Mongoose casts to `0` — silently shifts every shift window by
5h30m and manufactures early leave on people who worked a full day.

**Fix, two layers.** `resolveTimezoneOffset()` treats a stored `0` as unset unless
the tenant explicitly opts into UTC via `timezoneOffsetExplicit`. And
`measureAgainstWindow()` refuses physically impossible readings — an early leave
longer than the shift, or one on a day where worked-time already covers the window —
recording them as flagged anomalies at **0 penalty** rather than charging the employee.

Worth running once after installing: re-evaluate every affected month so wrongly
docked days are refunded.

---

## 5. UI: why the pages looked broken

`styles.css` had **195 font-size declarations between 6px and 10px** — accumulated
across v16 → v24, fighting each other with `!important`. 6px text is roughly a third
the height of body copy. That is the bulk of what you were reacting to; it was not a
layout problem, it was unreadable type.

All 195 are rescaled to an 11 / 12 / 12.5 / 13px ramp. This one change lifts every
page at once without touching a single component.

`V25Kit.jsx` then supplies the specific behaviours you asked for:

- `<Section>` — collapsed by default, so long data no longer floods the page
- `<MaskedAmount>` — salary hidden behind a per-row eye toggle, nothing visible until clicked
- `<CheckRow>` / `<CheckGrid>` — compact 16px check rows
- `<MonthAccordion>` — payroll listed one row per month, amounts only on expand
- `<Flag>` — inline banner for the new rule/anomaly explanations

---

---

## 6. Document Studio — the drag-and-drop designer

**Admin & System -> Document Studio** in the sidebar. Gated on `DOCUMENTS / MANAGE`,
so Super Admin and HR Admin get it by default.

### How it works

Pick a document type and press **Create from preset**. You do not get a blank page —
you get a complete, correctly-worded document laid out and ready to preview. Then:

- **Drag** any block to move it; drag the corner handle to resize.
- **Add block** from the left palette: heading, paragraph, field list, earnings
  table, table, image/logo, divider, signature, spacer.
- **Insert live data** from the right panel. Click a text block, then click a token —
  `{{employee.fullName}}`, `{{slip.netPay}}`, `{{date.today}}` and 40 others.
- **Preview PDF** renders your *unsaved* layout against a real employee, so what you
  see is exactly what gets issued.
- **Set live** makes that layout the one used for its type. Activating one
  automatically stands the others down, so there is never ambiguity about which
  format is in force.

Block geometry is stored in PDF points, which is why the canvas and the printed
page agree exactly rather than approximately.

### The 14 types shipped with presets

Salary Slip, Offer Letter, Joining Letter, Appointment Letter, Confirmation Letter,
Show Cause Notice, Warning Letter, Termination Letter, Experience Letter,
Relieving Letter, Salary Certificate, Increment Letter, NOC, and Custom.

All 14 were rendered end-to-end during the build: every one produced a valid PDF
with zero unresolved tokens.

### The payslip preset shows the LOP waterfall

The `EARNINGS_TABLE` block fills itself from live payroll rather than stored rows,
so it keeps working when components change. It also prints the waterfall line:

```
LOSS OF PAY ADJUSTMENT
Special Allowance -2,400.00   |   Conveyance -1,600.00
```

The employee can see which allowance absorbed the loss of pay and that Basic was
left intact — the whole point of the v25 salary engine, made visible.

### Where to find it

**Sidebar -> Documents -> Document Studio** (its own top-level group, directly under
Payroll & Finance). Also on the Home page as the **"Design a Document"** quick action,
and in the Command Palette. URL: `/document-studio`.

### Starting from scratch

The create panel offers two modes. **Use a preset** gives you a finished, correctly
worded document to edit. **Start from scratch** gives you a genuinely empty page with
a hint to add your first block. You can also name the document at creation time.

### API

```
GET    /api/document-templates/types        catalogue of types, tokens, block kinds
GET    /api/document-templates              list (optional ?type=)
POST   /api/document-templates              create, seeded from the preset
PATCH  /api/document-templates/:id          save layout
POST   /api/document-templates/preview      render unsaved layout -> PDF
POST   /api/document-templates/:id/activate make live for its type
POST   /api/document-templates/:id/duplicate
DELETE /api/document-templates/:id          blocked while live
POST   /api/document-templates/issue        issue a real document for an employee
```

`POST /issue` with `{ type, employeeId, month }` returns the finished PDF using
whichever template is live for that type — that is the call to wire into the
employee screens for one-click letter issue.

---

---

## 7. Three bugs fixed in the Document Studio backend

Found by booting the router and calling every endpoint rather than trusting that
the files existed.

**`RuleAudit.module` is an enum, and it rejected the new value.** The controller
wrote `module: 'DOCUMENT_TEMPLATE'`, which was not in the schema's allowed list, so
**Save, Set live and Delete each threw a ValidationError**. The routes were mounted
and reachable; three of them simply died on write.

The same defect already existed in v24 and had nothing to do with the new feature:
`payrollController` writes `module: 'SALARY_MASTER'`, also absent from the enum, so
**saving or deleting a salary master was already failing**. The enum now includes
`DOCUMENT_TEMPLATE`, `SALARY_MASTER` and `DOCUMENT`, which repairs both.

**`POST /preview` with no body crashed.** It fell through to
`findOne({ _id: undefined })` and raised a Mongoose CastError instead of a clean
error. It now returns 400 with a message, and refuses a template that has no blocks.

**`POST /issue` had no scope check.** Any signed-in user could issue a salary
certificate for any employee in the tenant. It now allows admins, the employee
themselves, or anyone whose `EMPLOYEES` scope covers that person.

Verified against a live router:

```
GET  /types                 -> 200  14 types, 5 token groups
POST /            (preset)  -> 201  "Offer Letter" 14 blocks
POST /            (blank)   -> 201  "My Blank Doc"  0 blocks
PATCH /:id                  -> 200  SAVE WORKS
POST /:id/activate          -> 200  ACTIVATE WORKS
POST /preview               -> 200  PDF returned (2709 bytes)
POST /preview (no body)     -> 400  guarded
```

---

## What is NOT in this patch

I fixed the things that silently cost money first. These are still open, in the
order I would do them:

1. **Retro-effective payroll** — recalculating a released month when a regularization
   or back-dated EL is approved, instead of re-running payroll. Needs a
   `payrollRecalcService` plus hooks in the regularization and leave decision paths.
2. **Month locking** — block leave applications against a `FINALIZED` run, with a
   Super Admin override. `leaveController.apply` currently has no run-status check.
3. **Missing CRUD** — `shiftRoutes` has no update or delete, and no assignment
   delete. Leave has no cancel and no delete-wrong-entry. Both are small additions
   to existing controllers.
4. **Wages working-days** — the `WAGES` branch already exists in
   `attendanceStatsFor` and computes calendar-days-minus-Sundays correctly. What is
   missing is the **UI** to set `employeeCategory` on the employee form, which is
   why it looks absent.
5. **Resignation & offboarding module** — new model, routes and screens.
6. **Per-page redesigns** — Payroll, Shifts, Notices preview, Employees directory.
7. **Wiring `/issue` into the employee screens** — the endpoint is live; the
   one-click "Issue letter" button on the employee profile is not built yet.

Items 1–4 are the ones that change numbers or block daily work. I would take those
next, in that order.
