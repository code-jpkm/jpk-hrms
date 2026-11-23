process.env.TZ = process.env.HRMS_SERVER_TZ || 'UTC';
const mongoose = require('mongoose');
const connectDb = require('./config/db');
const Tenant = require('./models/Tenant');
const User = require('./models/User');
const Employee = require('./models/Employee');
const LeavePolicy = require('./models/LeavePolicy');
const Shift = require('./models/Shift');
const PayrollRule = require('./models/PayrollRule');
const PayslipTemplate = require('./models/PayslipTemplate');
const AttendancePolicy = require('./models/AttendancePolicy');
const { JPK_PTAX_SLABS, JPK_PTAX_ABOVE_LAST_SLAB } = require('./services/startupUpdates');

const MIGRATION_VERSION = 22;

function missingProfileFields(raw = {}) {
  const missing = [];
  if (!raw.workLocation) missing.push('workLocation');
  if (!raw.employeeCategory) missing.push('employeeCategory');
  if (!raw.department) missing.push('department');
  if (!raw.designation) missing.push('designation');
  if (!raw.dateOfJoining) missing.push('dateOfJoining');
  if (raw.canApplyWfh === undefined) missing.push('canApplyWfh');
  if (raw?.statutory?.pfApplicable === undefined) missing.push('statutory.pfApplicable');
  if (raw?.statutory?.esiApplicable === undefined) missing.push('statutory.esiApplicable');
  if (raw?.statutory?.ptaxApplicable === undefined) missing.push('statutory.ptaxApplicable');
  return missing;
}

async function ensureTenant() {
  let tenant = await Tenant.findOne({ code: process.env.TENANT_CODE || 'JPK' });
  if (!tenant) {
    tenant = await Tenant.create({ name: process.env.TENANT_NAME || 'JPK Metallics Pvt. Ltd.', code: process.env.TENANT_CODE || 'JPK', status: 'ACTIVE' });
    console.log('Created tenant because none existed.');
  }
  return tenant;
}

async function ensureAdmin(tenant) {
  const existing = await User.findOne({ tenantId: tenant._id, role: 'SUPER_ADMIN' });
  if (existing) return existing;
  const email = String(process.env.SEED_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@jpkmetallics.com').toLowerCase().trim();
  const password = String(process.env.SEED_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '');
  let admin = await User.findOne({ tenantId: tenant._id, email }).select('+password');
  if (!admin) admin = new User({ tenantId: tenant._id, email });
  Object.assign(admin, { name: process.env.SEED_ADMIN_NAME || 'Super Admin', role: 'SUPER_ADMIN', status: 'ACTIVE', authProvider: 'PASSWORD', operationPermissions: { allowAll: true, modules: [] } });
  if (password) {
    admin.password = password;
    admin.forcePasswordChange = true;
  }
  await admin.save();
  console.log(`Created super-admin login only (${email}). No employee record was created.`);
  if (!password) console.log('No SEED_ADMIN_PASSWORD was set: set ADMIN_EMAIL + ADMIN_PASSWORD on the server and restart it to give this login a password.');
  return admin;
}

async function migrateEmployees(tenant) {
  // Read raw Mongo documents so Mongoose schema defaults do not hide fields that
  // were genuinely absent in older employee records. Only migration metadata is
  // written back; workplace/category/statutory choices are never guessed.
  const rawEmployees = await mongoose.connection.db.collection(Employee.collection.name)
    .find({ tenantId: tenant._id }, { projection: { _id: 1, workLocation: 1, employeeCategory: 1, department: 1, designation: 1, dateOfJoining: 1, canApplyWfh: 1, statutory: 1 } })
    .toArray();
  let review = 0;
  for (const raw of rawEmployees) {
    const missing = missingProfileFields(raw);
    await mongoose.connection.db.collection(Employee.collection.name).updateOne(
      { _id: raw._id, tenantId: tenant._id },
      { $set: { needsProfileReview: missing.length > 0, profileReviewMissing: missing, profileMigrationVersion: MIGRATION_VERSION } }
    );
    if (missing.length) review += 1;
  }
  return { total: rawEmployees.length, review };
}

async function seedConfiguration(tenant) {
  const shifts = [
    { name: 'Office Full Day', code: 'OFFICE-FULL', startTime: '09:30', endTime: '18:30', graceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240, weeklyOffDays: [0], active: true },
    { name: 'Office Saturday Half Day', code: 'OFFICE-SAT-HALF', startTime: '09:30', endTime: '14:00', graceMinutes: 15, fullDayMinutes: 240, halfDayMinutes: 120, weeklyOffDays: [0], active: true },
    { name: 'Factory Day', code: 'FACTORY-DAY', startTime: '08:00', endTime: '20:00', graceMinutes: 15, fullDayMinutes: 600, halfDayMinutes: 300, weeklyOffDays: [0], active: true },
    { name: 'Factory Night', code: 'FACTORY-NIGHT', startTime: '20:00', endTime: '08:00', crossesMidnight: true, graceMinutes: 15, fullDayMinutes: 600, halfDayMinutes: 300, weeklyOffDays: [0], active: true }
  ];
  for (const row of shifts) await Shift.findOneAndUpdate({ tenantId: tenant._id, name: row.name }, { $setOnInsert: { ...row, tenantId: tenant._id } }, { upsert: true, new: true, setDefaultsOnInsert: true });

  await AttendancePolicy.findOneAndUpdate(
    { tenantId: tenant._id },
    { $setOnInsert: { tenantId: tenant._id, name: 'JPK Attendance Policy', timezoneOffsetMinutes: 330, lateGraceMinutes: 15, lateGraceDaysPerMonth: 3, lateLopAfterGraceDays: 0.5, permissionLimitPerMonth: 3, earlyLeaveAllowedMinutes: 15, earlyLeavePermissionRequiredAfterMinutes: 15, earlyLeaveHalfDayAfterMinutes: 120, earlyLeaveLopDays: 0.5, medicalSpecialRequiresHr: true, active: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await PayrollRule.findOneAndUpdate(
    { tenantId: tenant._id, active: true },
    { $setOnInsert: { tenantId: tenant._id, name: 'JPK Statutory Payroll Rule', active: true,
      // The JPK rules (as in greytHR), see services/startupUpdates.js.
      pf: { enabled: true, employeePercent: 0.12, employerPercent: 0.12, wageCap: 15000, calculationBase: 'BASIC', applyWageCap: false },
      esi: { enabled: true, employeePercent: 0.0075, employerPercent: 0.0325, grossCap: 21000, calculationBase: 'BASIC' },
      ptax: { enabled: true, defaultAmount: JPK_PTAX_ABOVE_LAST_SLAB, slabs: JPK_PTAX_SLABS },
      notes: 'Seeded safely without touching employee or payroll transaction data.' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const policies = [
    { leaveType: 'EL', monthlyAccrual: 2, yearlyLimit: 24, carryForward: true, requiresApproval: true },
    { leaveType: 'CL', monthlyAccrual: 0, yearlyLimit: 0, carryForward: false, requiresApproval: true },
    { leaveType: 'SL', monthlyAccrual: 0, yearlyLimit: 0, carryForward: false, requiresApproval: true },
    { leaveType: 'COMP_OFF', monthlyAccrual: 0, yearlyLimit: 0, carryForward: true, requiresApproval: true }
  ];
  for (const row of policies) await LeavePolicy.findOneAndUpdate({ tenantId: tenant._id, leaveType: row.leaveType }, { $setOnInsert: { ...row, tenantId: tenant._id, active: true } }, { upsert: true, new: true, setDefaultsOnInsert: true });

  const hasTemplate = await PayslipTemplate.findOne({ tenantId: tenant._id, active: true });
  if (!hasTemplate) await PayslipTemplate.create({ tenantId: tenant._id, name: 'JPK Professional Payslip', active: true, companyName: tenant.name, footerText: 'Computer generated payslip.', primaryColor: '#3158d4', showBankLast4: true, showPfEsiNumbers: true, showAttendanceSummary: true });
}

async function run() {
  console.log('\n============================================================');
  console.log(' JPK HRMS v27 - SAFE MIGRATION SEED');
  console.log('============================================================');
  console.log('This seed NEVER deletes employees, users, attendance, salary, leave or payroll data.');
  await connectDb();
  try {
    const tenant = await ensureTenant();
    await ensureAdmin(tenant);
    const migration = await migrateEmployees(tenant);
    await seedConfiguration(tenant);
    console.log(`Existing employees preserved: ${migration.total}`);
    console.log(`Employees flagged for Super Admin profile review: ${migration.review}`);
    console.log('No dummy employees were created. No transaction collection was cleared. Existing HR rules/configuration were preserved.');
    console.log('Safe migration seed completed.');
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(async (error) => {
  console.error('Safe seed failed:', error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
