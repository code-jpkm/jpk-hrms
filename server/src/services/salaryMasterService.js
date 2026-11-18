const SalaryMaster = require('../models/SalaryMaster');

async function getActiveSalaryMaster({ tenantId, employeeId, month }) {
  const query = { tenantId, employeeId };
  if (month) query.effectiveMonth = { $lte: month };
  return SalaryMaster.findOne(query).sort('-effectiveMonth -updatedAt');
}

async function getActiveSalaryMastersMap({ tenantId, employeeIds, month }) {
  const query = { tenantId };
  if (employeeIds?.length) query.employeeId = { $in: employeeIds };
  if (month) query.effectiveMonth = { $lte: month };
  const masters = await SalaryMaster.find(query).sort('employeeId -effectiveMonth -updatedAt');
  const map = new Map();
  for (const master of masters) {
    const key = String(master.employeeId);
    if (!map.has(key)) map.set(key, master);
  }
  return map;
}

function salaryMasterTotals(master) {
  const earnings = master?.earnings || {};
  const deductions = master?.deductions || {};
  const grossSalary = Number(master?.grossSalary ?? 0) || Number(earnings.basic || 0) + Number(earnings.hra || 0) + Number(earnings.conveyance || 0) + Number(earnings.specialAllowance || 0) + Number(earnings.otherEarnings || 0);
  const totalDeductions = Number(master?.totalDeductions ?? 0) || Number(deductions.pf || 0) + Number(deductions.esi || 0) + Number(deductions.ptax || 0) + Number(deductions.otherDeductions || 0);
  const netSalary = Number(master?.netSalary ?? grossSalary - totalDeductions);
  return { grossSalary, totalDeductions, netSalary };
}

module.exports = { getActiveSalaryMaster, getActiveSalaryMastersMap, salaryMasterTotals };
