/**
 * Factory staff mark attendance on the fingerprint machine only.
 *
 * With the company setting on (the default), a person whose workplace is the
 * factory never meets phone check-in, geofencing, "anywhere" attendance or work
 * from home: the server answers as if those three switches were off for them,
 * refuses a phone punch or a work-from-home request, and keeps the switches off
 * when HR saves the person. HR turns the setting off in Company Settings.
 */
const Tenant = require('../models/Tenant');
const Employee = require('../models/Employee');

const MODE_FIELDS = ['canUseGeofencing', 'canUseAnywhereAttendance', 'canApplyWfh'];

function factoryFingerprintOnlyOn(tenant) {
  // A company saved before the setting existed has no value: that is "on".
  return tenant?.attendance?.factoryFingerprintOnly !== false;
}

function isFactoryWorker(employee) {
  return String(employee?.workLocation || '').toUpperCase() === 'FACTORY';
}

function fingerprintOnly(employee, tenant) {
  return Boolean(employee) && isFactoryWorker(employee) && factoryFingerprintOnlyOn(tenant);
}

async function tenantAttendanceSettings(tenantId) {
  if (!tenantId) return null;
  return Tenant.findById(tenantId).select('attendance').lean();
}

async function isFingerprintOnly(employee, tenantId) {
  if (!employee || !isFactoryWorker(employee)) return false;
  return factoryFingerprintOnlyOn(await tenantAttendanceSettings(tenantId || employee.tenantId));
}

/** The employee as their own apps see them: the three switches read "off" when fingerprint-only. */
function employeeForSelf(employee, onlyFingerprint) {
  if (!employee) return employee;
  const plain = typeof employee.toJSON === 'function' ? employee.toJSON() : { ...employee };
  if (onlyFingerprint) for (const field of MODE_FIELDS) plain[field] = false;
  plain.fingerprintOnly = Boolean(onlyFingerprint);
  return plain;
}

/** Turns the three switches off for every factory employee of the company. */
async function switchOffFactoryPhoneAttendance(tenantId) {
  const affected = await Employee.find({ tenantId, workLocation: 'FACTORY', $or: MODE_FIELDS.map((field) => ({ [field]: true })) })
    .select(['employeeCode', ...MODE_FIELDS].join(' '))
    .lean();
  if (affected.length) {
    await Employee.updateMany({ _id: { $in: affected.map((e) => e._id) } }, { $set: Object.fromEntries(MODE_FIELDS.map((field) => [field, false])) });
  }
  return affected;
}

module.exports = {
  MODE_FIELDS,
  factoryFingerprintOnlyOn,
  isFactoryWorker,
  fingerprintOnly,
  isFingerprintOnly,
  employeeForSelf,
  tenantAttendanceSettings,
  switchOffFactoryPhoneAttendance
};
