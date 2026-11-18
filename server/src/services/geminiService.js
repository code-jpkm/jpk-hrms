const ALLOWED_INTENTS = new Set([
  'ASSIGN_SHIFT','GRANT_LEAVE','APPLY_LEAVE','DECIDE_LEAVE','REGULARIZE_ATTENDANCE','DECIDE_REGULARIZATION',
  'UPDATE_EMPLOYEE','UPDATE_SALARY_MASTER','PUBLISH_NOTICE','CHANGE_ACCESS_SCOPE',
  'CHANGE_PAYROLL_RULE','CHANGE_PAYSLIP_TEMPLATE','CHANGE_LEAVE_POLICY','CHANGE_ATTENDANCE_RULE','UNKNOWN'
]);

function cleanJsonText(text){return String(text||'').trim().replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```$/i,'').trim()}

async function interpretHrCommand(prompt, { tenantId, userId } = {}) {
  const { generate, AiUnavailableError } = require('./ai/geminiClient');
  const { getConfig } = require('./integrationConfigService');
  const model = tenantId ? (await getConfig(tenantId)).ai.model : (process.env.GEMINI_MODEL || 'gemini-flash-latest');
  const systemText=`You are the structured command parser for a permission-controlled HRMS. Current date is ${new Date().toISOString().slice(0,10)}.
Return ONLY JSON with keys: intent, normalizedPrompt, parameters, explanation.
Allowed intents: ${[...ALLOWED_INTENTS].join(', ')}.
Never invent an employee, date, amount, leave balance, scope, shift or approval. If a required value is absent, omit it from parameters.
Resolve natural dates to YYYY-MM-DD only when the user supplied enough information. Resolve months to YYYY-MM.
Use these parameter conventions when relevant:
employee: name or employee code string; employees: array; date/fromDate/toDate; shiftName/startTime/endTime; weekdays array of 0=Sun..6=Sat;
leaveType, days, dayPart, reason, requestId, decision APPROVED|REJECTED;
for REGULARIZE_ATTENDANCE use requestedCheckIn/checkIn and requestedCheckOut/checkOut as HH:mm; requestType must be ATTENDANCE_CORRECTION, LATE_IN, EARLY_LEAVE, MEDICAL, or SPECIAL; use requestedMinutes and reason for permission-style requests;
fields object for UPDATE_EMPLOYEE; earnings object and otherDeductions/effectiveMonth for UPDATE_SALARY_MASTER; salary statutory PF/ESI/PT are calculated by HRMS rules, do not invent them;
title, body, audience BOTH|OFFICE|FACTORY|SELECTED, selectedEmployees array for PUBLISH_NOTICE;
targetUser, resource ATTENDANCE|SALARY|EMPLOYEE_PROFILE|LEAVE, scope BOTH|OFFICE|FACTORY|SELECTED, selectedEmployees array for CHANGE_ACCESS_SCOPE;
policy/rule changes in fields object.
Examples:
"Hey update the shift for Sayantan on 10th August it will be 11am to 5pm" => {"intent":"ASSIGN_SHIFT","parameters":{"employee":"Sayantan","date":"2026-08-10","startTime":"11:00","endTime":"17:00"}}.
"Apply 1 day EL for FAC001 on 2026-08-18 reason family work" => APPLY_LEAVE.
"Regularize Sayantan on 2026-08-12 check in 10:05 and check out 18:15, client visit" => REGULARIZE_ATTENDANCE with requestedCheckIn 10:05, requestedCheckOut 18:15 and reason client visit.
"Approve Sayantan's pending leave on 2026-08-18" => DECIDE_LEAVE with decision APPROVED.
"Set Sayantan department to MIS and workplace office" => UPDATE_EMPLOYEE with fields.
"Set FAC001 Aug 2026 basic 25000 hra 10000 special allowance 5000" => UPDATE_SALARY_MASTER effectiveMonth 2026-08.
"Publish notice to factory: furnace maintenance at 6pm" => PUBLISH_NOTICE audience FACTORY.
"Give Anirban attendance access to factory only" => CHANGE_ACCESS_SCOPE targetUser Anirban resource ATTENDANCE scope FACTORY.
"set late grace 15 minutes, 3 grace days, permission limit 3, lop 0.5" => CHANGE_ATTENDANCE_RULE fields.
Keep normalizedPrompt concise and explicit.`;
  try {
    const out = await generate({
      tenantId,
      userId,
      feature: 'COMMANDS',
      system: systemText,
      prompt,
      json: true,
      maxOutputTokens: 4096
    });
    const parsed = out.data || {};
    return {
      used: true,
      model: out.model,
      intent: ALLOWED_INTENTS.has(parsed.intent) ? parsed.intent : 'UNKNOWN',
      normalizedPrompt: String(parsed.normalizedPrompt || prompt),
      parameters: parsed.parameters && typeof parsed.parameters === 'object' ? parsed.parameters : {},
      explanation: String(parsed.explanation || '')
    };
  } catch (error) {
    const why = error instanceof AiUnavailableError ? error.message : `Gemini fallback: ${error.message}`;
    return { used: false, model, intent: 'UNKNOWN', normalizedPrompt: prompt, parameters: {}, explanation: `${why} Deterministic parsing was used where possible.` };
  }
}
module.exports={interpretHrCommand,ALLOWED_INTENTS};

/**
 * Turn a plain-language prompt into a dashboard widget SPEC.
 * Returns a plain object; the controller allow-lists every field before use,
 * so a bad model response cannot inject anything into the dashboard.
 */
async function interpretDashboardWidget({ prompt, allowedTypes = [], allowedBinds = [], tenantId, userId }) {
  const { generate } = require('./ai/geminiClient');
  const system = `You design dashboard widgets for an HR system. Return ONLY JSON with keys: type, title, size, tint, config.
type must be one of: ${allowedTypes.join(', ')}.
config.bind must be one of: ${allowedBinds.join(', ')}.
size is sm, md or lg. tint is indigo, teal, amber, rose, sky or violet.
config may also include label (short), helper (short) and icon (a lucide icon name).
Example: "how many people are in today" => {"type":"metric","title":"Present today","size":"sm","tint":"teal","config":{"bind":"attendanceToday","label":"Present","helper":"marked today","icon":"CalendarClock"}}`;
  try {
    const out = await generate({ tenantId, userId, feature: 'COMMANDS', system, prompt, json: true, maxOutputTokens: 2048, timeoutMs: 15000 });
    return { ...(out.data || {}), used: true };
  } catch (error) {
    return { used: false, error: error.message };
  }
}

module.exports.interpretDashboardWidget = interpretDashboardWidget;
