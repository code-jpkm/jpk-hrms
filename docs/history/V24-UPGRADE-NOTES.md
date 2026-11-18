# JPK PeopleOS v24 — UI & Attendance Rule Refinement

This build is a focused refinement of the v23 premium frontend and attendance engine. It does **not** require a seed and does not introduce dummy employees.

## What changed

### Shift Planner
- Removed the Recent Shift Assignments/log section from the page.
- Shift templates are shown as a premium selectable card library.
- Office / Factory / Both employee grouping no longer duplicates BOTH employees.
- Bulk weekday assignment remains, including the Office Saturday preset.
- Employee selection uses only active Employee Directory employees.

### Notice Board
- Published image notices render an inline image preview.
- Published PDF notices render an inline PDF preview with Open action.
- Other files render a clean document card.
- The publish drawer previews image/PDF attachments before publishing.
- Existing Cloudinary storage is retained.

### Access Control
- Backend user list is now derived from active Employee Directory records with a real `userId` link.
- Orphan/demo portal accounts are not shown in Access Control.
- Permission modules are collapsed by default.
- Checkbox matrices were replaced with compact permission action pills.
- Global checkbox/radio CSS was fixed so native controls stay 16px instead of inheriting large input height.

### Progressive disclosure / long data
The following technical or long sections are closed by default:
- Raw biometric punch audit
- AI command audit trail
- Exact geofence coordinate list
- Existing visibility grants
- Salary Master configuration
- PF/ESI/P.Tax advanced configuration
- Payslip PDF designer
- Manual payslip sharing
- Advanced attendance custom rules

### Payroll privacy and released payroll
- Salary Master remains collapsed by default.
- Employee salary values are masked by default and revealed employee-by-employee using a View/eye control.
- Payslip values use the same privacy behavior.
- Payroll generation creates/updates a DRAFT run.
- A new **Release payroll** action finalizes a run.
- The **Released payroll** month selector only lists FINALIZED payroll runs.
- Selecting a released month reveals its Net, Gross, Deductions and Employee totals.
- Releasing payroll creates in-app notifications for employees in that payroll run.

### Holiday Planner
- Replaced the large flat table with an annual month-grouped card view.
- Added compact annual summary and next-holiday information.
- Holiday location is an explicit Office + Factory / Office / Factory selector.

### Attendance rule correction
- Late-in and early-leave use one combined monthly exception counter.
- First configured N events (default 3) do not create LOP.
- A first late in the month can no longer become HALF DAY simply because worked minutes are below an old `fullDayMinutes` value.
- Custom late/early penalty rules are also prevented from overriding those protected first-N events.
- A genuine short worked duration below the configured half-day threshold can still classify as HALF DAY.
- The explicit hard early-leave half-day threshold remains stronger than the monthly quota.
- Existing historical punch records are self-recalculated when the attendance month is opened.

### Attendance calendar live state
For today's open punch:
- Calendar shows `IN`.
- It also shows `On time · in HH:MM`, or `Late in · Xm · in HH:MM`.
- The attendance drawer repeats the same live interpretation while checkout is pending.

### Visual system
- Home page styling remains the visual benchmark.
- Operating pages now use compact premium heroes, softer cards, consistent spacing, progressive disclosure, privacy-first salary rows, responsive layouts and small native controls.
- React Hot Toast remains globally mounted for mutation success/error/loading feedback.
- Page/route skeleton lazy-loading from v23 remains intact.

## Deployment

Frontend:

```bash
cd client_fixed
npm install
npm run dev
```

Backend:

```bash
cd server
npm install
npm run dev
```

## Seed

**Do not run `npm run seed` for this v24 update.**

No new master data is required for these changes. Restart frontend/backend and use the existing database.
