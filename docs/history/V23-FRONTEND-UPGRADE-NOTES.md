# JPK HRMS v23 – Premium UI, Skeleton Loading & Reliable Toasts

This release focuses on frontend experience and does **not require a database seed**.

## 1. YouTube-style loading experience

- All major application pages now use `React.lazy()` and `Suspense` so modules load only when opened.
- Navigation links prefetch the destination module on hover/focus and during safe idle time, so lazy routes still feel fast.
- A shared skeleton system provides page, card, table, directory and inline shimmer placeholders.
- API-backed screens using `useApi()` automatically participate in the global data-loading skeleton layer.
- Employee/candidate document panels use inline skeletons while their document lists load.
- Employee profile images use native lazy image loading and async decoding.
- Off-screen cards/rows use `content-visibility` where appropriate to reduce rendering work on long pages.
- Skeleton timing is slightly delayed to avoid flicker for very fast requests.

## 2. React Hot Toast fixed globally

`react-hot-toast` is mounted once at the application root with a very high z-index so it cannot disappear behind drawers, headers or modals.

Every normal POST / PUT / PATCH / DELETE API operation now follows this lifecycle:

1. Loading toast appears immediately.
2. Success replaces that same toast when the operation succeeds.
3. Failure replaces it with the server/API error when the operation fails.

Shift operations have explicit messages:

- Creating a shift: `Creating shift template…` → `<Shift name> created successfully`
- Assigning a shift: `Assigning shift and recalculating attendance…` → `Shift assigned to N employees successfully`

Employee, recruitment and payroll downloads also show success/failure toast feedback.

## 3. Premium design system applied beyond Home

The shared UI components and legacy modules were restyled to follow the visual language of the premium Home page:

- softer white/glass surfaces
- consistent rounded panels and shadows
- cleaner typography hierarchy
- modern buttons and input focus states
- readable sticky-header tables
- premium empty/error/success states
- refined tabs, chips, stats and drawers
- improved attendance, leave, shift planner and employee directory surfaces
- upgraded module hero headers for Payroll, Holidays, Birthdays, Recruitment, Company Settings, Probation, Biometric and Hierarchy
- responsive layouts for desktop, tablet and mobile

## 4. Files introduced or heavily changed

- `client_fixed/src/App.jsx`
- `client_fixed/src/main.jsx`
- `client_fixed/src/api/client.js`
- `client_fixed/src/hooks/useApi.js`
- `client_fixed/src/state/loadingStore.js`
- `client_fixed/src/utils/routePrefetch.js`
- `client_fixed/src/components/Loading.jsx`
- `client_fixed/src/components/Layout.jsx`
- `client_fixed/src/components/Ui.jsx`
- `client_fixed/src/components/AppLauncher.jsx`
- `client_fixed/src/components/CommandPalette.jsx`
- `client_fixed/src/components/NotificationCenter.jsx`
- multiple pages under `client_fixed/src/pages/`
- `client_fixed/src/styles.css`

## Installation

Frontend:

```bash
cd client_fixed
npm install
npm run dev
```

Backend (normal restart only):

```bash
cd server
npm install
npm run dev
```

### Seed?

**No.** These v23 changes are frontend loading, feedback and UI improvements. Do not run the seed just for this update.
