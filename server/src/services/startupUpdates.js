/**
 * One-time data updates, run when the server starts (after the database
 * connects). Each update is recorded in RuleAudit under its own action name and
 * runs once per company: later changes made on the Payroll page stay as HR set
 * them.
 */
const Tenant = require('../models/Tenant');
const PayrollRule = require('../models/PayrollRule');
const RuleAudit = require('../models/RuleAudit');
const { factoryFingerprintOnlyOn, switchOffFactoryPhoneAttendance } = require('./attendanceModeService');

// JPK statutory rules from November 2026, the same as in greytHR:
//   PF   12% of the earned Basic, on the full Basic (no ₹15,000 limit)
//   ESI  0.75% of the earned Basic; no ESI when the monthly Basic is above ₹21,000
//   P.Tax on the month's gross: up to 20,000 → 0 · up to 30,000 → 100 ·
//        up to 50,000 → 140 · up to 1,00,000 → 170 · above → 208
const JPK_PTAX_SLABS = [
  { from: 0, to: 20000, amount: 0 },
  { from: 20001, to: 30000, amount: 100 },
  { from: 30001, to: 50000, amount: 140 },
  { from: 50001, to: 100000, amount: 170 }
];
const JPK_PTAX_ABOVE_LAST_SLAB = 208;

async function applyJpkStatutoryRules(tenantId) {
  let rule = await PayrollRule.findOne({ tenantId, active: true });
  const before = rule ? rule.toObject() : null;
  if (!rule) rule = new PayrollRule({ tenantId, active: true, name: 'Default Payroll Rule' });
  rule.set('pf.applyWageCap', false);
  rule.set('esi.enabled', true);
  rule.set('esi.calculationBase', 'BASIC');
  rule.set('esi.grossCap', 21000);
  rule.set('ptax.enabled', true);
  rule.set('ptax.slabs', JPK_PTAX_SLABS);
  rule.set('ptax.defaultAmount', JPK_PTAX_ABOVE_LAST_SLAB);
  await rule.save();
  return { before, after: rule.toObject() };
}

// Factory staff mark attendance on the fingerprint machine only (the new company
// setting, on by default): any phone check-in, geofencing, anywhere or WFH switch
// left on for a factory employee is turned off once.
async function applyFactoryFingerprintOnly(tenantId) {
  const tenant = await Tenant.findById(tenantId).select('attendance').lean();
  if (!factoryFingerprintOnlyOn(tenant)) return { before: null, after: { skipped: 'Factory fingerprint-only is turned off for this company' } };
  const switchedOff = await switchOffFactoryPhoneAttendance(tenantId);
  return { before: { employees: switchedOff }, after: { switchedOff: switchedOff.length } };
}

const UPDATES = [
  {
    action: 'STARTUP_2026_11_STATUTORY_AS_GREYTHR',
    module: 'PAYROLL',
    reason: 'Statutory rules as in greytHR: PF on the full Basic, ESI on Basic (none above ₹21,000 Basic), new professional tax slabs',
    apply: applyJpkStatutoryRules
  },
  {
    action: 'STARTUP_2026_11_FACTORY_FINGERPRINT_ONLY',
    module: 'ATTENDANCE',
    reason: 'Factory staff use the fingerprint machine only: phone check-in, geofencing, anywhere attendance and work from home switched off for factory employees',
    apply: applyFactoryFingerprintOnly
  }
];

async function runStartupUpdates() {
  const tenants = await Tenant.find({ status: 'ACTIVE' }).select('_id').lean();
  for (const update of UPDATES) {
    for (const tenant of tenants) {
      try {
        const done = await RuleAudit.exists({ tenantId: tenant._id, module: update.module, action: update.action });
        if (done) continue;
        const { before, after } = await update.apply(tenant._id);
        await RuleAudit.create({ tenantId: tenant._id, module: update.module, action: update.action, before, after, reason: update.reason, source: 'SYSTEM' });
        console.log(`[startup] ${update.action} applied for company ${tenant._id}`);
      } catch (error) {
        console.error(`[startup] ${update.action} failed for company ${tenant._id}:`, error.message);
      }
    }
  }
}

module.exports = { runStartupUpdates, JPK_PTAX_SLABS, JPK_PTAX_ABOVE_LAST_SLAB };
