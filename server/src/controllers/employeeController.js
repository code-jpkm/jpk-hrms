const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const { recordAudit } = require('../services/auditService');
const ApiError = require('../utils/apiError');
const Employee = require('../models/Employee');
const User = require('../models/User');
const AccessGrant = require('../models/AccessGrant');
const { getScopedEmployeeIds } = require('../services/scopeService');
const { ensureProbationReview } = require('../services/probationService');
const { writeEmployeeLetterToStream } = require('../services/documentPdfService');
const { normalizeObjectId, ensureManagerAssignmentIsValid } = require('../utils/hierarchy');
const { readWorkbookRows, workbookBuffer, parseImportDate } = require('../utils/excel');
const { dateKey, semanticDateKey, companyToday } = require('../utils/date');
const { hasAbility } = require('../middleware/auth');
const guard = require('../services/accountGuardService');
const loginAccess = require('../services/loginAccessService');


function reviewMissingFields(employee) {
  const missing = [];
  if (!employee.workLocation) missing.push('workLocation');
  if (!employee.employeeCategory) missing.push('employeeCategory');
  if (!employee.department) missing.push('department');
  if (!employee.designation) missing.push('designation');
  if (!employee.dateOfJoining) missing.push('dateOfJoining');
  return missing;
}

function markProfileReview(employee, supplied = {}) {
  const missing = new Set(Array.isArray(employee.profileReviewMissing) ? employee.profileReviewMissing : []);
  const coreFields = ['workLocation', 'employeeCategory', 'department', 'designation', 'dateOfJoining'];
  for (const field of coreFields) {
    if (employee[field]) missing.delete(field);
    else missing.add(field);
  }

  // Old records may have inherited schema defaults for statutory flags even though
  // the original Mongo document never contained those choices. Keep the migration
  // warning until an admin explicitly submits the corresponding field.
  for (const field of ['pfApplicable', 'esiApplicable', 'ptaxApplicable']) {
    const key = `statutory.${field}`;
    if (supplied.statutory && Object.prototype.hasOwnProperty.call(supplied.statutory, field)) {
      if (typeof supplied.statutory[field] === 'boolean') missing.delete(key);
      else missing.add(key);
    }
  }

  // WFH is an explicit entitlement, never an assumed default for migrated staff.
  if (Object.prototype.hasOwnProperty.call(supplied, 'canApplyWfh') && typeof supplied.canApplyWfh === 'boolean') {
    missing.delete('canApplyWfh');
  }

  employee.needsProfileReview = missing.size > 0;
  employee.profileReviewMissing = Array.from(missing);
  employee.profileMigrationVersion = 22;
}

function parseBoolean(value, fallback = true) {
  if (value === '' || value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  return !['NO', 'N', 'FALSE', '0'].includes(String(value).trim().toUpperCase());
}

function parseOptionalBoolean(value) {
  if (value === '' || value === undefined || value === null) return undefined;
  return parseBoolean(value, false);
}

function compactExcelPayload(row) {
  const payload = {};
  for (const [key, value] of Object.entries(row)) {
    if (['createLogin', 'sendWelcome'].includes(key)) continue;
    if (key === 'statutory') {
      const statutory = {};
      for (const [statKey, statValue] of Object.entries(value || {})) {
        if (statValue !== '' && statValue !== undefined && statValue !== null) statutory[statKey] = statValue;
      }
      if (Object.keys(statutory).length) payload.statutory = statutory;
      continue;
    }
    if (value !== '' && value !== undefined && value !== null) payload[key] = value;
  }
  return payload;
}

function assertRoleAssignmentAllowed(req, role) {
  return guard.assertRoleAssignmentAllowed(req.user, role);
}

const isAdminUser = (user) => guard.isAdminRole(user?.role);
const fullNameOf = (employee) => `${employee.firstName || ''} ${employee.lastName || ''}`.trim();

async function assertProfileEmployeeVisible(req, employeeId) {
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'EMPLOYEE_PROFILE' });
  if (!allowed.includes(String(employeeId))) throw new ApiError(403, 'Employee is outside your People Office / Factory scope');
}

async function assertNewEmployeeLocationAllowed(req, workLocation) {
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role)) return;
  const grant = await AccessGrant.findOne({ tenantId: req.tenantId, viewerUserId: req.user._id, resource: 'EMPLOYEE_PROFILE' }).lean();
  const allowedLocations = grant?.canViewAll
    ? (grant.workLocations?.length ? grant.workLocations : ['OFFICE', 'FACTORY'])
    : (grant?.workLocations || []);
  const requested = String(workLocation || '').toUpperCase();
  const allowed = requested === 'BOTH'
    ? allowedLocations.includes('OFFICE') && allowedLocations.includes('FACTORY')
    : allowedLocations.includes(requested);
  if (!allowed) throw new ApiError(403, 'Creating a new employee requires broad People access to that Office / Factory section');
}

function firstPresent(...values) {
  return values.find((value) => value !== '' && value !== null && value !== undefined);
}

function cellText(...values) {
  return String(firstPresent(...values) ?? '').trim();
}

/** Excel serial or text ("05/04/2024" is 5 April) -> UTC-midnight Date; records unreadable dates. */
function excelDate(value, label, rowErrors, date1904) {
  const parsed = parseImportDate(value, { date1904 });
  if (parsed === null) rowErrors.push(`${label} "${value}" is not a valid date (use DD/MM/YYYY)`);
  return parsed || undefined;
}

function normalizeExcelEmployeeRow(row, { date1904 = false } = {}) {
  const dateErrors = [];
  return {
    employeeCode: cellText(row.employeeCode, row['Employee Code'], row['EmployeeCode']),
    firstName: cellText(row.firstName, row['First Name'], row['FirstName']),
    lastName: cellText(row.lastName, row['Last Name'], row['LastName']),
    email: cellText(row.email, row['Email']).toLowerCase(),
    phone: cellText(row.phone, row['Phone']),
    department: cellText(row.department, row['Department']),
    designation: cellText(row.designation, row['Designation']),
    workLocation: cellText(row.workLocation, row['Work Location'], row['WorkLocation']).toUpperCase(),
    employeeCategory: cellText(row.employeeCategory, row['Employee Category'], row['EmployeeCategory']).toUpperCase(),
    dateOfJoining: excelDate(firstPresent(row.dateOfJoining, row['Date of Joining'], row['DateOfJoining']), 'Date of Joining', dateErrors, date1904),
    dateOfBirth: excelDate(firstPresent(row.dateOfBirth, row['Date of Birth'], row['DateOfBirth']), 'Date of Birth', dateErrors, date1904),
    status: cellText(row.status, row['Status']).toUpperCase(),
    canApplyWfh: parseOptionalBoolean(firstPresent(row.canApplyWfh, row['WFH Allowed'])),
    statutory: {
      pfApplicable: parseOptionalBoolean(firstPresent(row.pfApplicable, row['PF Applicable'])),
      esiApplicable: parseOptionalBoolean(firstPresent(row.esiApplicable, row['ESI Applicable'])),
      ptaxApplicable: parseOptionalBoolean(firstPresent(row.ptaxApplicable, row['PTax Applicable'])),
      uan: cellText(row.uan, row['UAN']),
      esiNumber: cellText(row.esiNumber, row['ESI Number']),
      pan: cellText(row.pan, row['PAN'])
    },
    createLogin: parseBoolean(firstPresent(row.createLogin, row['Create Login']), false),
    sendWelcome: false,
    dateErrors
  };
}

// v26: the list hid only `salary`; bank accounts, Aadhaar and PAN went to every
// manager. Personal/bank/statutory identifiers now need admin, EMPLOYEES:UPDATE
// (the people who edit them) or the employee themself.
function canSeeSalary(req) {
  return isAdminUser(req.user) || hasAbility(req.user, 'PAYROLL', 'UPDATE_SALARY_MASTER');
}
function canSeePersonal(req) {
  return isAdminUser(req.user) || hasAbility(req.user, 'EMPLOYEES', 'UPDATE');
}

function withoutSensitiveSalaryForEmployeeList(req, employees) {
  const salaryAllowed = canSeeSalary(req);
  const personalAllowed = canSeePersonal(req);
  return employees.filter(Boolean).map((employee) => {
    const obj = employee.toObject({ virtuals: true });
    const isSelf = req.employee && String(req.employee._id) === String(employee._id);
    if (!salaryAllowed && !isSelf) delete obj.salary;
    if (!personalAllowed && !isSelf) {
      delete obj.bankDetails;
      delete obj.personalDetails;
      delete obj.onboardingDocuments;
      if (obj.statutory) {
        const { pfApplicable, esiApplicable, ptaxApplicable } = obj.statutory;
        obj.statutory = { pfApplicable, esiApplicable, ptaxApplicable };
      }
    }
    if (req.user.role !== 'SUPER_ADMIN') {
      delete obj.needsProfileReview;
      delete obj.profileReviewMissing;
      delete obj.profileMigrationVersion;
    }
    return obj;
  });
}

/**
 * v26: the request body used to be copied onto the employee almost verbatim
 * (only _id / userId / timestamps were removed), so a profile editor could set
 * tenantId (moving the record to another company), salary, probation or
 * attendance flags — on their own record too. Only these fields are accepted.
 */
const EMPLOYEE_FIELDS = ['employeeCode', 'firstName', 'lastName', 'email', 'phone', 'profilePhotoUrl', 'department', 'designation',
  'workLocation', 'employeeCategory', 'employmentType', 'previousExperienceYears', 'previousCompany', 'dateOfJoining', 'dateOfBirth',
  'reportsTo', 'status', 'personalDetails', 'emergencyContact', 'bankDetails', 'statutory', 'onboardingDocuments', 'biometric',
  'canApplyWfh', 'canUseGeofencing', 'canUseAnywhereAttendance', 'salary', 'probation'];
const NESTED_EMPLOYEE_FIELDS = ['personalDetails', 'emergencyContact', 'bankDetails', 'statutory', 'onboardingDocuments', 'biometric', 'salary', 'probation'];
// HR-owned facts a non-admin may not change on their own profile.
const SELF_LOCKED_FIELDS = ['employeeCode', 'workLocation', 'employeeCategory', 'employmentType', 'dateOfJoining', 'reportsTo', 'status',
  'biometric', 'canApplyWfh', 'canUseGeofencing', 'canUseAnywhereAttendance', 'salary', 'probation'];

function normalizeDateInput(value, label) {
  if (value === '' || value === null) return null;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, `${label} is not a valid date`);
    return d;
  }
  const parsed = parseImportDate(s);
  if (!parsed) throw new ApiError(400, `${label} "${s}" is not a valid date (use DD/MM/YYYY or YYYY-MM-DD)`);
  return parsed;
}

async function sanitizeEmployeePayload({ req, body = {}, existing, employeeId }) {
  const admin = isAdminUser(req.user);
  const isSelf = Boolean(existing && req.employee && String(existing._id) === String(req.employee._id));
  const payload = {};
  const ignored = [];
  for (const field of EMPLOYEE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body || {}, field)) continue;
    if (!admin) {
      if (isSelf && SELF_LOCKED_FIELDS.includes(field)) { ignored.push(field); continue; }
      if (field === 'salary' && !hasAbility(req.user, 'PAYROLL', 'UPDATE_SALARY_MASTER')) { ignored.push(field); continue; }
      if (field === 'probation' && !hasAbility(req.user, 'PROBATION', 'MANAGE')) { ignored.push(field); continue; }
    }
    payload[field] = body[field];
  }
  if (payload.email !== undefined) payload.email = String(payload.email || '').toLowerCase().trim();
  if (payload.workLocation !== undefined) payload.workLocation = String(payload.workLocation || '').toUpperCase() || undefined;
  if (payload.employeeCategory !== undefined) payload.employeeCategory = String(payload.employeeCategory || '').toUpperCase() || undefined;
  if (payload.status !== undefined) payload.status = String(payload.status || '').toUpperCase() || undefined;
  if (payload.dateOfJoining !== undefined) payload.dateOfJoining = normalizeDateInput(payload.dateOfJoining, 'Date of joining');
  if (payload.dateOfBirth !== undefined) payload.dateOfBirth = normalizeDateInput(payload.dateOfBirth, 'Date of birth');
  if (payload.reportsTo !== undefined) {
    const managerId = normalizeObjectId(payload.reportsTo);
    if (!managerId) payload.reportsTo = null;
    else {
      if (!mongoose.isValidObjectId(managerId)) throw new ApiError(400, 'Invalid reporting manager');
      payload.reportsTo = await ensureManagerAssignmentIsValid({ tenantId: req.tenantId, employeeId: employeeId || existing?._id, reportsTo: managerId });
    }
  }
  return { payload, ignored };
}

/** Applies a sanitised payload; nested objects merge field-by-field so a partial row never wipes the rest. */
function assignEmployeeFields(doc, payload) {
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    if (NESTED_EMPLOYEE_FIELDS.includes(key) && value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      for (const [sub, subValue] of Object.entries(value)) if (subValue !== undefined) doc.set(`${key}.${sub}`, subValue);
    } else {
      doc.set(key, value === null ? undefined : value);
    }
  }
}

exports.listEmployees = asyncHandler(async (req, res) => {
  const scopedIds = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'EMPLOYEE_PROFILE' });
  const q = { tenantId: req.tenantId, _id: { $in: scopedIds } };
  if (typeof req.query.status === 'string' && req.query.status) q.status = req.query.status;
  if (req.query.workLocation && ['OFFICE','FACTORY','BOTH'].includes(req.query.workLocation)) q.workLocation = req.query.workLocation;
  const employees = await Employee.find(q).populate('reportsTo', 'firstName lastName employeeCode').populate('userId', 'name email phone role status forcePasswordChange passwordChangedAt tempPasswordSentAt lastLoginAt lastSeenAt').sort('employeeCode');
  res.json({ employees: withoutSensitiveSalaryForEmployeeList(req, employees) });
});

/** Create-or-update one imported row. Existing rows merge nested fields (dotted paths). */
async function upsertImportedEmployee(req, row) {
  const code = String(row.employeeCode || '').trim();
  const existing = await Employee.findOne({ tenantId: req.tenantId, employeeCode: code });
  if (existing) await assertProfileEmployeeVisible(req, existing._id);
  else await assertNewEmployeeLocationAllowed(req, row.workLocation);
  const target = existing || new Employee({ tenantId: req.tenantId });
  const { payload } = await sanitizeEmployeePayload({ req, body: row, existing, employeeId: target._id });
  if (existing) {
    if (payload.status === 'OFFBOARDED' && existing.status !== 'OFFBOARDED') delete payload.status;
    assignEmployeeFields(existing, payload);
  } else {
    assignEmployeeFields(target, payload);
    if (!payload.status) target.status = 'ACTIVE';
  }
  markProfileReview(target, payload);
  await target.save();
  return { employee: target, created: !existing };
}

exports.bulkUpsertEmployees = asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) throw new ApiError(400, 'rows array is required');
  const results = { created: 0, updated: 0, errors: [] };
  for (let index = 0; index < rows.length; index += 1) {
    try {
      const row = rows[index] || {};
      if (!row.employeeCode || !row.firstName) throw new Error('employeeCode and firstName are required');
      const outcome = await upsertImportedEmployee(req, { ...row, employeeCode: String(row.employeeCode).trim() });
      if (outcome.created) results.created += 1; else results.updated += 1;
    } catch (error) { results.errors.push({ row: index + 2, employeeCode: rows[index]?.employeeCode, message: error.message }); }
  }
  res.json(results);
});


exports.employeeImportTemplate = asyncHandler(async (req, res) => {
  const headers = ['Employee Code','First Name','Last Name','Email','Phone','Department','Designation','Work Location','Employee Category','Date of Joining','Date of Birth','Status','WFH Allowed','PF Applicable','ESI Applicable','PTax Applicable','UAN','ESI Number','PAN','Create Login'];
  const buffer = workbookBuffer({
    sheetName: 'Employees', headers,
    instructions: [
      'Do not change the header names.',
      'Work Location: OFFICE, FACTORY or BOTH.',
      'Employee Category: SALARIED or WAGES.',
      'WFH Allowed: YES only for employees who are permitted to request Work From Home. Blank/NO keeps WFH hidden.',
      'For existing Employee Code rows, upload updates the employee instead of creating a duplicate.',
      'Create Login can be YES/NO. Login is never created without an email.',
      'The seed never creates dummy employees; use this file for real employee migration.'
    ]
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="JPK-Employee-Import-Template.xlsx"');
  res.end(buffer);
});

exports.importEmployeesExcel = asyncHandler(async (req, res) => {
  // raw: dates are read from the Excel serial, never from the US-formatted display text.
  const sheet = readWorkbookRows(req.body.dataUrl, { raw: true });
  const rows = sheet.map((row) => normalizeExcelEmployeeRow(row, { date1904: sheet.date1904 })).filter((row) => row.employeeCode || row.firstName);
  if (!rows.length) throw new ApiError(400, 'No employee rows found in the first Excel sheet');
  const results = { created: 0, updated: 0, errors: [] };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    try {
      if (!row.employeeCode || !row.firstName) throw new Error('Employee Code and First Name are required');
      if (!['OFFICE','FACTORY','BOTH'].includes(row.workLocation)) throw new Error('Work Location is required and must be OFFICE, FACTORY or BOTH');
      if (!['SALARIED','WAGES'].includes(row.employeeCategory)) throw new Error('Employee Category must be SALARIED or WAGES');
      if (row.dateErrors.length) throw new Error(row.dateErrors.join('; '));
      const { dateErrors, ...rowValues } = row;
      const { employee } = await upsertImportedEmployee(req, compactExcelPayload(rowValues))
        .then((outcome) => { if (outcome.created) results.created += 1; else results.updated += 1; return outcome; });
      if (row.createLogin && employee.email && !employee.userId) {
        const user = await guard.resolveLoginForEmployee({ actor: req.user, tenantId: req.tenantId, employee, email: employee.email, phone: employee.phone, name: fullNameOf(employee) });
        employee.userId = user._id;
        await employee.save();
      }
    } catch (error) {
      results.errors.push({ row: index + 2, employeeCode: row.employeeCode, message: error.message });
    }
  }
  res.json(results);
});

exports.createEmployee = asyncHandler(async (req, res) => {
  const body = req.body || {};
  await assertNewEmployeeLocationAllowed(req, body.workLocation);
  const requestedRole = body.role ? assertRoleAssignmentAllowed(req, body.role) : undefined;
  const email = String(body.email || '').toLowerCase().trim();
  if (body.createLogin !== false && !email) {
    throw new ApiError(400, 'Mail ID / login email is required when Create login is enabled');
  }
  if (body.sendWelcome !== false && body.createLogin === false) {
    throw new ApiError(400, 'Create login must be enabled before sending welcome email/WhatsApp');
  }
  // Validate everything (fields, reporting manager, code, login ownership) before
  // writing, so a refused request leaves no half-created employee or login behind.
  const employee = new Employee({ tenantId: req.tenantId });
  const { payload, ignored } = await sanitizeEmployeePayload({ req, body: { ...body, email }, employeeId: employee._id });
  if (payload.status === 'OFFBOARDED') throw new ApiError(400, 'A new employee cannot start as offboarded');
  assignEmployeeFields(employee, payload);
  if (!payload.status) employee.status = 'ACTIVE';
  markProfileReview(employee, payload);
  await employee.validate();
  if (await Employee.exists({ tenantId: req.tenantId, employeeCode: employee.employeeCode })) {
    throw new ApiError(409, `Employee code ${employee.employeeCode} already exists`);
  }
  let user = null;
  if (email && body.createLogin !== false) {
    user = await guard.resolveLoginForEmployee({ actor: req.user, tenantId: req.tenantId, employee, email, phone: employee.phone, name: fullNameOf(employee) || email, role: requestedRole });
    employee.userId = user._id;
  }
  await employee.save();
  await ensureProbationReview(employee);
  // v27: a new login gets a one-time password by email / WhatsApp (and shown once to HR).
  const login = user && body.sendWelcome !== false ? await loginAccess.giveLoginDetails({ tenantId: req.tenantId, employee, user }) : null;
  res.status(201).json({
    employee,
    user: user ? user.toJSON() : null,
    notificationLogs: login?.notificationLogs || [],
    temporaryPassword: login?.temporaryPassword,
    loginDelivered: login?.delivered,
    loginMessage: login?.message,
    ignoredFields: ignored
  });
});

exports.updateEmployee = asyncHandler(async (req, res) => {
  const existing = await Employee.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!existing) throw new ApiError(404, 'Employee not found');
  await assertProfileEmployeeVisible(req, existing._id);
  const body = req.body || {};
  if (body.workLocation && String(body.workLocation).toUpperCase() !== String(existing.workLocation || '').toUpperCase()) await assertNewEmployeeLocationAllowed(req, body.workLocation);
  const linkedUser = existing.userId ? await User.findOne({ _id: existing.userId, tenantId: req.tenantId }) : null;
  const { payload, ignored } = await sanitizeEmployeePayload({ req, body, existing, employeeId: existing._id });

  // Only a real change of the login's role counts (the edit form always sends the current role).
  const requestedRole = body.role ? String(body.role).trim().toUpperCase() : null;
  const roleChanged = Boolean(linkedUser && requestedRole && requestedRole !== linkedUser.role);
  if (roleChanged) {
    assertRoleAssignmentAllowed(req, requestedRole);
    guard.assertCanManageAccount(req.user, linkedUser);
  }
  const emailChanged = payload.email !== undefined && payload.email !== String(existing.email || '').toLowerCase();
  if (emailChanged && linkedUser) {
    guard.assertCanManageAccount(req.user, linkedUser);
    if (!payload.email) throw new ApiError(400, 'This employee has a portal login, so the email cannot be blank. Disable the login instead.');
    if (await User.exists({ tenantId: req.tenantId, email: payload.email, _id: { $ne: linkedUser._id } })) throw new ApiError(409, 'Another login already uses this email');
  }
  const offboarding = payload.status === 'OFFBOARDED' && existing.status !== 'OFFBOARDED';
  if (offboarding) {
    if (!isAdminUser(req.user) && !hasAbility(req.user, 'EMPLOYEES', 'DELETE')) throw new ApiError(403, 'Offboarding needs EMPLOYEES:DELETE');
    guard.assertCanManageAccount(req.user, linkedUser);
  }

  assignEmployeeFields(existing, payload);
  markProfileReview(existing, payload);
  await existing.save();
  await ensureProbationReview(existing);
  if (linkedUser) {
    const $set = { name: fullNameOf(existing) || linkedUser.name, phone: existing.phone };
    const $unset = {};
    if (roleChanged) $set.role = requestedRole;
    if (emailChanged) {
      // The login moves to the new address; the password stays the same.
      $set.email = existing.email;
    }
    if (offboarding) $set.status = 'DISABLED';
    await User.updateOne({ _id: linkedUser._id, tenantId: req.tenantId }, { $set, ...(Object.keys($unset).length ? { $unset } : {}) });
  }
  const employee = await Employee.findOne({ _id: existing._id, tenantId: req.tenantId }).populate('reportsTo', 'firstName lastName employeeCode').populate('userId', 'name email phone role status forcePasswordChange passwordChangedAt tempPasswordSentAt lastLoginAt lastSeenAt');
  res.json({ employee: withoutSensitiveSalaryForEmployeeList(req, [employee])[0] || null, ignoredFields: ignored });
});

exports.resendLogin = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!employee) throw new ApiError(404, 'Employee not found');
  await assertProfileEmployeeVisible(req, employee._id);
  if (!employee.email) throw new ApiError(400, 'Add the employee\'s email first: it is their login name');
  if (employee.status === 'OFFBOARDED') throw new ApiError(400, 'This employee is offboarded. Re-activate the profile before sending login details.');
  // Reuses an existing (e.g. disabled, unlinked) login for this email instead of
  // inserting a duplicate, which used to fail with E11000 for re-hired staff.
  // "Give portal access" may pick the role for a brand-new login (Employee by default).
  const defaultRole = (req.body || {}).role ? String(req.body.role).trim().toUpperCase() : undefined;
  const user = await guard.resolveLoginForEmployee({ actor: req.user, tenantId: req.tenantId, employee, email: employee.email, phone: employee.phone, name: fullNameOf(employee), defaultRole });
  guard.assertCanManageAccount(req.user, user);
  if (String(employee.userId || '') !== String(user._id)) {
    employee.userId = user._id;
    await employee.save();
  }
  const login = await loginAccess.giveLoginDetails({ tenantId: req.tenantId, employee, user });
  res.json({
    message: login.message,
    temporaryPassword: login.temporaryPassword,
    loginDelivered: login.delivered,
    notificationLogs: login.notificationLogs,
    loginEmail: user.email
  });
});

/** One click: everyone who cannot sign in yet gets login details. */
exports.sendLoginDetailsToAll = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const outcome = await loginAccess.giveLoginDetailsToAll({
    tenantId: req.tenantId, actor: req.user, includeWaiting: Boolean(body.includeWaiting), includeReady: Boolean(body.includeReady)
  });
  const handOver = outcome.results.filter((r) => r.temporaryPassword).length;
  const parts = [`${outcome.delivered} sent by email / WhatsApp`];
  if (handOver) parts.push(`${handOver} need you to hand over the temporary password`);
  if (outcome.failed) parts.push(`${outcome.failed} could not be done (see below)`);
  res.json({
    ...outcome,
    message: outcome.total
      ? `Login details made for ${outcome.total} ${outcome.total === 1 ? 'person' : 'people'}: ${parts.join(', ')}.`
      : 'Nobody to send to: everyone with an email can already sign in.'
  });
});

/** Who "Send login details to everyone" would reach (shown before sending). */
exports.loginDetailsPlan = asyncHandler(async (req, res) => {
  const plan = await loginAccess.loginDetailsPlan({ tenantId: req.tenantId, actor: req.user });
  res.json({ ...plan, counts: loginAccess.planCounts(plan) });
});

/** Counts for the People page button. */
exports.loginStatusSummary = asyncHandler(async (req, res) => {
  const plan = await loginAccess.loginDetailsPlan({ tenantId: req.tenantId, actor: req.user });
  const counts = loginAccess.planCounts(plan);
  res.json({ withoutPassword: counts.toSend, ...counts });
});

/** "Turn off portal access": the person can no longer sign in. Their records stay. */
exports.turnOffPortalAccess = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!employee) throw new ApiError(404, 'Employee not found');
  await assertProfileEmployeeVisible(req, employee._id);
  const user = employee.userId ? await User.findOne({ _id: employee.userId, tenantId: req.tenantId }) : null;
  if (!user) throw new ApiError(400, 'This employee has no portal access to turn off');
  if (String(user._id) === String(req.user._id)) throw new ApiError(400, 'You cannot turn off your own portal access');
  guard.assertCanManageAccount(req.user, user);
  await User.updateOne({ _id: user._id, tenantId: req.tenantId }, { $set: { status: 'DISABLED' } });
  await recordAudit({ tenantId: req.tenantId, module: 'EMPLOYEE', action: 'PORTAL_ACCESS_OFF', targetId: String(user._id), after: { status: 'DISABLED' }, reason: `Turned off portal access for ${fullNameOf(employee) || user.email}`, changedBy: req.user?._id });
  res.json({ message: `Portal access turned off for ${fullNameOf(employee) || user.email}. They can no longer sign in.` });
});

exports.offboardEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!employee) throw new ApiError(404, 'Employee not found');
  await assertProfileEmployeeVisible(req, employee._id);
  const linkedUser = employee.userId ? await User.findOne({ _id: employee.userId, tenantId: req.tenantId }) : null;
  guard.assertCanManageAccount(req.user, linkedUser);
  employee.status = 'OFFBOARDED';
  await employee.save();
  if (linkedUser) await User.updateOne({ _id: linkedUser._id, tenantId: req.tenantId }, { $set: { status: 'DISABLED' } });
  res.json({ employee });
});

const ACCESS_RESOURCES = ['ATTENDANCE', 'SALARY', 'EMPLOYEE_PROFILE', 'LEAVE'];

exports.upsertAccessGrant = asyncHandler(async (req, res) => {
  const body = req.body || {};
  // "EMPLOYEE PROFILE" (space) was sent by an older client; normalise it.
  const resource = String(body.resource || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!ACCESS_RESOURCES.includes(resource)) throw new ApiError(400, `resource must be one of ${ACCESS_RESOURCES.join(', ')}`);
  let viewerUserId = body.viewerUserId?._id || body.viewerUserId;
  if (!viewerUserId && req.params.id && mongoose.isValidObjectId(req.params.id)) {
    viewerUserId = (await Employee.findOne({ _id: req.params.id, tenantId: req.tenantId }).select('userId').lean())?.userId;
  }
  if (!viewerUserId || !mongoose.isValidObjectId(viewerUserId) || !(await User.exists({ _id: viewerUserId, tenantId: req.tenantId }))) {
    throw new ApiError(404, 'Viewer login not found');
  }
  const workLocations = [...new Set((Array.isArray(body.workLocations) ? body.workLocations : []).map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
  if (workLocations.some((x) => !['OFFICE', 'FACTORY'].includes(x))) throw new ApiError(400, 'workLocations may only contain OFFICE and FACTORY');
  const employeeIds = [...new Set((Array.isArray(body.employeeIds) ? body.employeeIds : []).map((x) => String(x?._id || x)))];
  if (employeeIds.some((id) => !mongoose.isValidObjectId(id))) throw new ApiError(400, 'employeeIds contains an invalid id');
  if (employeeIds.length && (await Employee.countDocuments({ tenantId: req.tenantId, _id: { $in: employeeIds } })) !== employeeIds.length) {
    throw new ApiError(400, 'One or more selected employees do not belong to this company');
  }
  const grant = await AccessGrant.findOneAndUpdate(
    { tenantId: req.tenantId, viewerUserId, resource },
    { $set: { canViewAll: Boolean(body.canViewAll), employeeIds, workLocations, notes: body.notes, createdBy: req.user._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );
  res.json({ grant });
});


exports.listUsers = asyncHandler(async (req, res) => {
  // Access Control must represent the real Employee Directory, not orphaned/demo
  // portal accounts. Only users linked to an active employee are returned.
  const linkedEmployees = await Employee.find({
    tenantId: req.tenantId,
    userId: { $exists: true, $ne: null },
    status: { $ne: 'OFFBOARDED' }
  }).select('userId employeeCode firstName lastName department designation workLocation status').lean();
  const employeeByUser = new Map(linkedEmployees.map((employee) => [String(employee.userId), employee]));
  const userIds = linkedEmployees.map((employee) => employee.userId).filter(Boolean);
  const users = await User.find({ tenantId: req.tenantId, _id: { $in: userIds } }).select('-password').sort('name email').lean();
  res.json({
    users: users.map((user) => ({
      ...user,
      employee: employeeByUser.get(String(user._id)) || null
    }))
  });
});

exports.updateUserPermissions = asyncHandler(async (req, res) => {
  const { role, status, operationPermissions } = req.body;
  const user = await User.findOne({ _id: req.params.userId, tenantId: req.tenantId });
  if (!user) throw new ApiError(404, 'User not found');
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role) && req.user.role !== 'SUPER_ADMIN') throw new ApiError(403, 'Only Super Admin can edit administrator accounts');
  if (String(user._id) === String(req.user._id) && req.user.role !== 'SUPER_ADMIN') throw new ApiError(403, 'You cannot change your own access');
  if (role) user.role = assertRoleAssignmentAllowed(req, role);
  if (status) {
    const nextStatus = String(status).toUpperCase();
    if (!['ACTIVE', 'DISABLED'].includes(nextStatus)) throw new ApiError(400, 'status must be ACTIVE or DISABLED');
    user.status = nextStatus;
  }
  // allowAll / SYSTEM grants are Super Admin only; they bypass every module check.
  if (operationPermissions) user.operationPermissions = guard.sanitizeOperationPermissions(req.user, operationPermissions);
  await user.save();
  const obj = user.toObject();
  delete obj.password;
  res.json({ user: obj });
});

exports.listAccessGrants = asyncHandler(async (req, res) => {
  const linkedEmployees = await Employee.find({
    tenantId: req.tenantId,
    userId: { $exists: true, $ne: null },
    status: { $ne: 'OFFBOARDED' }
  }).select('userId').lean();
  const linkedUserIds = linkedEmployees.map((employee) => employee.userId).filter(Boolean);
  const grants = await AccessGrant.find({ tenantId: req.tenantId, viewerUserId: { $in: linkedUserIds } })
    .populate('viewerUserId', 'name email role')
    .populate('employeeIds', 'employeeCode firstName lastName')
    .sort('-updatedAt');
  res.json({ grants });
});

exports.deleteAccessGrant = asyncHandler(async (req, res) => {
  const grant = await AccessGrant.findOneAndDelete({ _id: req.params.grantId, tenantId: req.tenantId });
  if (!grant) throw new ApiError(404, 'Access grant not found');
  res.json({ deleted: true });
});

exports.deleteEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!employee) throw new ApiError(404, 'Employee not found');
  await assertProfileEmployeeVisible(req, employee._id);
  const linkedUser = employee.userId ? await User.findOne({ _id: employee.userId, tenantId: req.tenantId }) : null;
  guard.assertCanManageAccount(req.user, linkedUser);
  if (linkedUser) await User.updateOne({ _id: linkedUser._id, tenantId: req.tenantId }, { $set: { status: 'DISABLED' } });
  await Employee.deleteOne({ _id: employee._id, tenantId: req.tenantId });
  res.json({ deleted: true });
});

/**
 * GET /api/employees/birthdays?month=11 | ?upcoming=30
 *
 * v26: celebrations are company-wide (name, department and day-month only, never
 * the birth year), so every employee can see and wish colleagues. Dates are read
 * as calendar days (semanticDateKey): the old getMonth() call put a birthday on
 * 1 June into May whenever it had been saved at IST midnight.
 */
exports.birthdays = asyncHandler(async (req, res) => {
  const admin = isAdminUser(req.user) || hasAbility(req.user, 'EMPLOYEES', 'READ');
  const todayKey = dateKey(companyToday());
  const year = Number(todayKey.slice(0, 4));
  const todayUtc = new Date(`${todayKey}T00:00:00.000Z`);
  const monthFilter = req.query.month ? Number(req.query.month) : null;
  const upcoming = Math.min(Math.max(Number(req.query.upcoming || 0), 0), 366);
  const employees = await Employee.find({ tenantId: req.tenantId, status: { $ne: 'OFFBOARDED' } })
    .select('employeeCode firstName lastName department designation workLocation dateOfBirth dateOfJoining profilePhotoUrl userId').lean();

  function next(key) {
    const [, mm, dd] = key.split('-').map(Number);
    let when = new Date(Date.UTC(year, mm - 1, dd));
    if (when < todayUtc) when = new Date(Date.UTC(year + 1, mm - 1, dd));
    return { when, daysAway: Math.round((when - todayUtc) / 86400000), mm, dd };
  }
  const base = (e) => ({ id: e._id, employeeCode: e.employeeCode, name: `${e.firstName} ${e.lastName || ''}`.trim(), firstName: e.firstName, department: e.department || '', designation: e.designation || '', workLocation: e.workLocation, profilePhotoUrl: e.profilePhotoUrl || '', isSelf: Boolean(req.employee && String(req.employee._id) === String(e._id)) });
  const keep = (n) => (monthFilter ? n.mm === monthFilter : upcoming ? n.daysAway <= upcoming : true);

  const birthdays = employees.filter((e) => e.dateOfBirth).map((e) => {
    const key = semanticDateKey(e.dateOfBirth);
    const n = next(key);
    return { ...base(e), date: dateKey(n.when), monthDay: key.slice(5), daysAway: n.daysAway, isToday: n.daysAway === 0, ...(admin ? { dateOfBirth: e.dateOfBirth } : {}), _n: n };
  }).filter((x) => keep(x._n)).map(({ _n, ...x }) => x).sort((a, b) => (monthFilter ? a.monthDay.localeCompare(b.monthDay) : a.daysAway - b.daysAway));

  const anniversaries = employees.filter((e) => e.dateOfJoining).map((e) => {
    const key = semanticDateKey(e.dateOfJoining);
    const n = next(key);
    const years = n.when.getUTCFullYear() - Number(key.slice(0, 4));
    return { ...base(e), date: dateKey(n.when), monthDay: key.slice(5), daysAway: n.daysAway, isToday: n.daysAway === 0, years, joinedOn: key, _n: n };
  }).filter((x) => x.years > 0 && keep(x._n)).map(({ _n, ...x }) => x).sort((a, b) => (monthFilter ? a.monthDay.localeCompare(b.monthDay) : a.daysAway - b.daysAway));

  res.json({ today: todayKey, birthdays, anniversaries });
});

exports.downloadLetter = asyncHandler(async (req, res) => {
  const { id, type } = req.params;
  if (!['offer', 'joining'].includes(type)) throw new ApiError(400, 'Letter type must be offer or joining');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'EMPLOYEE_PROFILE' });
  if (!allowed.includes(String(id))) throw new ApiError(403, 'Employee is outside your scope');
  const employee = await Employee.findOne({ _id: id, tenantId: req.tenantId });
  if (!employee) throw new ApiError(404, 'Employee not found');
  // Gross salary is printed only for people who may already see it.
  const isSelf = req.employee && String(req.employee._id) === String(employee._id);
  const includeSalary = Boolean(isAdminUser(req.user) || isSelf || hasAbility(req.user, 'PAYROLL', 'READ'));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${type}-letter-${String(employee.employeeCode).replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`);
  await writeEmployeeLetterToStream({ tenantId: req.tenantId, employee, type, stream: res, includeSalary });
});
