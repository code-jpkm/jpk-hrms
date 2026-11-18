# Attendance machines — the simple way

eSSL and ZKTeco machines with **ADMS / Cloud Server** send every punch to the HRMS by themselves. You don't need bridge software, device IDs or tokens.

In the HRMS, open **Attendance machines** (9-dot menu → Setup). Then:
1. Click **Add machine** and type its serial number. The serial number is on the machine under M/OK → System Info → Device Info → Serial No., and on the sticker at the back.
2. Set up the machine as described below and restart it. The page shows the same values to type into the machine.

## Which way fits your machine?

Most eSSL machines can only send plain `http`, but the HRMS on Render only accepts `https`. Pick one of these:

| | Needs | On the machine (Menu → COMM → Cloud Server Setting) |
|---|---|---|
| **A. Office computer relay** (works with every machine) | Any always-on computer in the same network, with Node.js | Server Mode **ADMS** · Enable Domain Name **OFF** · Server Address = **that computer's IP** · Server Port **8081** · Proxy **OFF** |
| **B. Straight to the HRMS** (only if the machine supports https) | Nothing | Server Mode **ADMS** · Enable Domain Name **ON** · Server Address = **the HRMS API address** · Server Port **443** · Proxy **OFF** |
| **C. Cloudflare relay** (no computer) | The company domain on Cloudflare | Server Mode **ADMS** · Enable Domain Name **ON** · Server Address **punch.yourcompany.com** · Server Port **80** · Proxy **OFF** |

For B and C, the machine also needs to reach the internet. Under **Menu → COMM → Ethernet**, set:
- **Gateway:** your router, for example 192.168.1.1.
- **DNS:** 8.8.8.8.

## A. Office computer relay

1. Install Node.js (LTS) from https://nodejs.org on a computer that stays on.
2. Copy this `machine-relay` folder to that computer.
3. Open `start-relay.bat` in Notepad and set `APP_URL` to your HRMS **API** address. Save it.
   - The Attendance machines page can also download a ready-filled `start-relay.bat`.
4. Double-click `start-relay.bat`. The window shows the **Server Address** to type into the machine. Keep the window open.
5. On the machine, set the values from table row A, then restart the machine.
6. Within a minute the machine shows **Connected** on the **Attendance machines** page. If you didn't add it first, it appears there waiting: click **Approve**.

To start the relay with Windows: press **Win + R**, type `shell:startup`, press Enter, and put a shortcut to `start-relay.bat` in that folder.

The computer and the machine must be in the same network. For example, a computer at 192.168.1.100 and a machine at 192.168.1.10.

## C. Cloudflare relay

The setup steps are at the top of `cloudflare-worker.js`. After setting it up, add `ADMS_RELAY_HOST=punch.yourcompany.com` to the HRMS server settings, so the page shows that address.

## After the machine connects

1. **Added it first?** It counts straight away. **Didn't add it?** It appears waiting: check that the serial number matches the one under Menu → System Info → Device Info, pick the day from which punches count, and click **Approve**. Older punches are kept but not added.
2. **Link machine IDs to people.** The page lists every ID that punched, with the name stored on the machine; pick the employee for each one. If the machine ID equals the employee code, or the employee's **Device User ID** is already set, the link is made automatically.
3. **Punches start counting.** The first punch of the day is the check-in and the last is the check-out. A second press within 2 minutes is ignored, and night shifts close the next morning. A day corrected through an approved regularization is never changed by later punches.

## Server settings (optional, in the server `.env`)

| Setting | Default | What it does |
|---|---|---|
| `ADMS_RELAY_HOST` | – | Address of a Cloudflare relay, shown on the setup card |
| `ADMS_PUBLIC_HOST` / `ADMS_PUBLIC_PORT` | the API's own address / 443 | Address the setup card shows for "straight to the HRMS" |
| `ADMS_SERIALS` | – | Serial numbers approved automatically (comma separated) |
| `ADMS_TENANT_ID` | the only company | Company that new machines belong to, when there are several |
| `ADMS_TIMEZONE` | 330 | Time zone sent to the machine for its clock (`off` = don't send) |
| `ADMS_TZ_OFFSET_MINUTES` | 330 | Time zone of the machine's punch times |
| `ADMS_POLL_SECONDS` | 30 | How often the machine checks in |
| `BIOMETRIC_DUPLICATE_MINUTES` | 2 | Punches this close together count as one |
| `ADMS_AUTO_CLOCK_FIX` | on | Correct punches when the machine clock is on UTC (`off` to disable) |
