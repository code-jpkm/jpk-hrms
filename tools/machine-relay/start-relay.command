#!/bin/bash
# Mac / Linux: double-click (Mac) or run ./start-relay.command
# Put your HRMS server address here (the API address, not the website).
export APP_URL="https://YOUR-HRMS.onrender.com"
cd "$(dirname "$0")"
node attendance-relay.js
