# JPK HRMS — Android app (v27)

The phone app for JPK HRMS v27. Same colours, fonts, icons and time-of-day
scenery as the website, written in React Native with Expo (JavaScript / JSX only,
no TypeScript).

It lives in the `android-app` folder of the website project and talks to the
same server as the website (https://jpk-hrms.onrender.com), so there is nothing
extra to deploy for the app.

## What is in the app

| Tab / screen | What people can do |
| --- | --- |
| Sign in | Email or employee code, password and the picture captcha. Forgot password. Temporary passwords from HR must be changed first. |
| Home | Greeting on the live landscape, **Check in / Check out with the phone's location**, shortcuts, team numbers for managers, leave balance, latest payslip, celebrations, holidays, notices. |
| Attendance | Month calendar (P / A / HD / L / H / WO), tap a day for punches, worked time, late or early, and "Request a correction for this day". |
| Leave | Balances, apply for leave or work from home (full day or half day), your requests, withdraw a pending one. |
| Payslips | Your released payslips; download the PDF and open or share it. |
| More | Everything else. Holidays, notice board, celebrations, corrections, profile. Managers also get **Approvals** and **Team today**. Admin modules (Employees, Payroll runs, Attendance machines, Settings…) open the website. |
| Bell | In-app notifications (approvals, payslips, notices); tapping one opens the right screen. |
| Profile | Your details, HR documents (open/share), change password, server address, sign out. |

## 1. Server address

The app already points at **https://jpk-hrms.onrender.com** (`EXPO_PUBLIC_SERVER_URL` in `eas.json`).
If the address ever changes, edit it there (it appears twice) and build again.
It can also be changed inside the app: sign-in screen **Server: … · Change**, or **Profile → Server address**.

## 2. Build the APK (on your Mac)

You need Node.js 20 or newer. In Terminal:

```bash
cd ~/Downloads/hrms-nextjs-v27/android-app
npm install
npx eas-cli@latest login      # the Expo account "sm009" (same project as the old app)
npm run build:apk             # builds the .apk in Expo's cloud
```

`npm run build:apk` runs `EAS_NO_VCS=1 npx eas-cli@latest build -p android --profile preview`.
`EAS_NO_VCS=1` uploads only this `android-app` folder, not the whole website project (`.easignore` lists what is left out).

When the build finishes, EAS shows a link and a QR code. Open it on the phone,
download the APK and allow "Install unknown apps" for your browser.

* Same Android package as the old app (`hrms.jpk`) with a higher version (27), so it installs as an update.
  If Android says **"App not installed"**, the old app was signed with a different key:
  uninstall the old app once, then install this one.
* Using a different Expo account? Delete `"owner"` and the `"extra": { "eas": … }` block in `app.json`,
  then run `npx eas-cli@latest init` before building.
* For the Play Store, build an app bundle instead: `EAS_NO_VCS=1 npx eas-cli@latest build -p android --profile production`.

## Try it without building

Install **Expo Go** (SDK 54) on an Android phone, then on the Mac:

```bash
cd ~/Downloads/hrms-nextjs-v27/android-app
cp .env.example .env          # already has https://jpk-hrms.onrender.com
npx expo start                # scan the QR code with Expo Go
```

## Good to know

* **Phone check-in** uses the same rules as the website. HR sets them on the website:
  who may check in from the phone (**Geofencing enabled** / **Anywhere attendance**
  on the employee's form) and the office locations with their radius (Company settings).
  The location is read only when the person taps Check in or Check out.
* The server must be HTTPS (Render is). Android blocks plain `http://` addresses.
* The sign-in is kept on the phone. Changing the password signs out every other phone and browser.
* `npm run check:js-only` fails if a `.ts` or `.tsx` file is ever added.
* Icons come from `src/components/icons.js` (only the ones the app uses, to keep the app small).
  To use another lucide icon, add one line there, for example
  `export { default as Bell } from 'lucide-react-native/dist/esm/icons/bell';`.

## Folders

```
App.jsx                 fonts, sign-in state, navigation
src/navigation/         sign-in screens, bottom tabs, inner pages
src/screens/            one file per screen (auth/ for sign-in screens)
src/components/         UI kit (cards, buttons, inputs, sheet, pickers),
                        DayScene (the website's landscape), captcha, top bars
src/state/              sign-in (AuthContext) and notifications (InboxContext)
src/api/client.js       calls to the server (adds /api and the sign-in token)
src/utils/              dates in India time, attendance labels, permissions, file download
assets/                 app icon, splash, JPK logo
```
