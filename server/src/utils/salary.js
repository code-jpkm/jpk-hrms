/**
 * Salary engine — v25
 *
 * KEY CHANGE vs v24:
 * ------------------
 * v24 prorated EVERY component by the same payable-days ratio, so a single LOP
 * day cut the employee's Basic. Basic drives PF, gratuity and statutory
 * reporting, so it must be protected.
 *
 * v25 uses a CASCADING LOP WATERFALL. The rupee value of the LOP is computed
 * once from monthly gross, then absorbed component by component in a
 * configurable order. Basic is always LAST.
 *
 *   Special Allowance -> Conveyance -> HRA -> Other Earnings -> Basic
 *
 * Each component is drained to zero before the next one is touched, so Basic is
 * only reduced when the LOP is large enough to exhaust every allowance.
 */

const DEFAULT_LOP_WATERFALL = ['specialAllowance', 'conveyance', 'hra', 'otherEarnings', 'basic'];
const COMPONENT_KEYS = ['basic', 'hra', 'conveyance', 'specialAllowance', 'otherEarnings'];

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * DANGEROUS LEGACY BEHAVIOUR, now guarded.
 *
 * The PayrollRule schema stores rates as FRACTIONS (pf 0.12, esi 0.0075) but the
 * admin UI invites people to type "12" and "0.75". The old heuristic was
 * `n > 1 ? n / 100 : n`, which silently turned an ESI rate typed as 0.75
 * (meaning 0.75%) into 75%. On a 20,000 gross that is 15,000 of ESI instead of
 * 150.
 *
 * `unit` can be set per rule ('FRACTION' | 'PERCENT') to remove the ambiguity.
 * Without it we keep the heuristic but clamp at `maxFraction` so a unit mistake
 * can never silently wipe out a salary.
 */
function asPercent(value, fallback, options = {}) {
  const { unit = 'AUTO', maxFraction = 0.5, label = 'rate' } = options;
  const raw = Number(value ?? fallback ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;

  let fraction;
  if (unit === 'PERCENT') fraction = raw / 100;
  else if (unit === 'FRACTION') fraction = raw;
  else fraction = raw > 1 ? raw / 100 : raw;

  if (fraction > maxFraction) {
    // Almost certainly a percent typed where a fraction was expected.
    const corrected = fraction / 100;
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`[salary] ${label} of ${raw} resolves to ${(fraction * 100).toFixed(2)}%, above the ${(maxFraction * 100).toFixed(0)}% sanity ceiling. Using ${(corrected * 100).toFixed(4)}% instead. Set payrollRule.percentUnit to remove the ambiguity.`);
    }
    return corrected;
  }
  return fraction;
}

function masterEarnings(master) {
  const e = master?.earnings || {};
  return {
    basic: Number(e.basic || 0),
    hra: Number(e.hra || 0),
    conveyance: Number(e.conveyance || 0),
    specialAllowance: Number(e.specialAllowance || 0),
    otherEarnings: Number(e.otherEarnings || 0)
  };
}

function masterDeductions(master) {
  const d = master?.deductions || {};
  return {
    pf: Number(d.pf || 0),
    esi: Number(d.esi || 0),
    ptax: Number(d.ptax || 0),
    otherDeductions: Number(d.otherDeductions || 0)
  };
}

function salaryTotals(employee, salaryMaster) {
  if (salaryMaster) {
    const earnings = masterEarnings(salaryMaster);
    const gross = Number(salaryMaster.grossSalary || 0)
      || earnings.basic + earnings.hra + earnings.conveyance + earnings.specialAllowance + earnings.otherEarnings;
    return { basic: earnings.basic, gross, earnings };
  }
  const basic = Number(employee?.salary?.basic || 0);
  const hra = Number(employee?.salary?.hra || 0);
  const conveyance = Number(employee?.salary?.conveyance || 0);
  const specialAllowance = Number(employee?.salary?.specialAllowance || 0);
  const allowances = Number(employee?.salary?.allowances || 0);
  const gross = Number(employee?.salary?.gross || 0)
    || basic + hra + conveyance + specialAllowance + allowances;
  return { basic, gross, earnings: { basic, hra, conveyance, specialAllowance, otherEarnings: allowances } };
}

function baseAmount(employee, base, salaryMaster) {
  const { basic, gross } = salaryTotals(employee, salaryMaster);
  return base === 'BASIC' ? basic : gross;
}

/**
 * Resolve the waterfall order. Any component the admin omits is appended in the
 * default order, and 'basic' is force-moved to the end so it can never be
 * configured to absorb LOP before the allowances.
 */
function resolveWaterfall(rule) {
  const configured = Array.isArray(rule?.lopWaterfall) && rule.lopWaterfall.length
    ? rule.lopWaterfall.filter((key) => COMPONENT_KEYS.includes(key))
    : DEFAULT_LOP_WATERFALL;
  const ordered = [];
  for (const key of configured) if (!ordered.includes(key)) ordered.push(key);
  for (const key of DEFAULT_LOP_WATERFALL) if (!ordered.includes(key)) ordered.push(key);
  return [...ordered.filter((k) => k !== 'basic'), 'basic'];
}

/**
 * Absorb `lopAmount` rupees across the salary components in waterfall order.
 * Returns the earned components plus a per-component audit trail so the payslip
 * and the UI can show exactly where the money came from.
 */
function applyLopWaterfall({ components, lopAmount, rule }) {
  const order = resolveWaterfall(rule);
  const earned = { ...components };
  const breakdown = [];
  let remaining = roundMoney(Math.max(0, Number(lopAmount || 0)));

  for (const key of order) {
    if (remaining <= 0.005) break;
    const available = roundMoney(Math.max(0, Number(earned[key] || 0)));
    if (available <= 0) continue;
    const taken = roundMoney(Math.min(available, remaining));
    earned[key] = roundMoney(available - taken);
    remaining = roundMoney(remaining - taken);
    breakdown.push({ component: key, deducted: taken, remainingComponent: earned[key], exhausted: earned[key] === 0 });
  }

  for (const key of COMPONENT_KEYS) earned[key] = roundMoney(earned[key] || 0);

  return {
    earned,
    breakdown,
    absorbed: roundMoney(Number(lopAmount || 0) - remaining),
    unabsorbed: roundMoney(remaining), // LOP larger than the whole gross
    order
  };
}

function calculateStatutoryDeductions({ employee, rule, salaryMaster }) {
  if (salaryMaster?.calculationMode !== 'RULE_BASED_DEDUCTIONS') {
    const manual = masterDeductions(salaryMaster);
    if (salaryMaster) {
      return {
        pf: roundMoney(manual.pf),
        esi: roundMoney(manual.esi),
        ptax: roundMoney(manual.ptax),
        custom: manual.otherDeductions ? { Other: roundMoney(manual.otherDeductions) } : {},
        otherDeductions: roundMoney(manual.otherDeductions),
        total: roundMoney(manual.pf + manual.esi + manual.ptax + manual.otherDeductions)
      };
    }
  }

  const { basic, gross } = salaryTotals(employee, salaryMaster);
  const pfRule = rule?.pf || {};
  const esiRule = rule?.esi || {};
  const ptaxRule = rule?.ptax || {};

  const pfRawBase = pfRule.calculationBase === 'GROSS' ? gross : basic;
  const pfBase = pfRule.applyWageCap === false || !pfRule.wageCap
    ? pfRawBase
    : Math.min(pfRawBase, Number(pfRule.wageCap || 0));
  const unit = rule?.percentUnit || 'AUTO';
  const pf = pfRule.enabled === false || employee?.statutory?.pfApplicable === false
    ? 0
    : pfBase * asPercent(pfRule.employeePercent, 0.12, { unit, maxFraction: 0.5, label: 'PF employee percent' });

  const esiRawBase = esiRule.calculationBase === 'BASIC' ? basic : gross;
  const esiApplicable = employee?.statutory?.esiApplicable !== false
    && esiRule.enabled !== false
    && (!esiRule.grossCap || gross <= Number(esiRule.grossCap));
  const esi = esiApplicable
    ? esiRawBase * asPercent(esiRule.employeePercent, 0.0075, { unit, maxFraction: 0.1, label: 'ESI employee percent' })
    : 0;

  let ptax = 0;
  // No salary earned means no professional tax: a fully-LOP month used to end
  // with a negative net pay of -₹200.
  if (gross > 0 && ptaxRule.enabled !== false && employee?.statutory?.ptaxApplicable !== false) {
    const slabs = ptaxRule.slabs || [];
    const matched = slabs.find((slab) => gross >= Number(slab.from || 0) && gross <= Number(slab.to || Number.MAX_SAFE_INTEGER));
    ptax = matched ? Number(matched.amount || 0) : Number(ptaxRule.defaultAmount || 0);
  }

  const custom = {};
  let customTotal = Number(salaryMaster?.deductions?.otherDeductions || 0);
  if (customTotal) custom.Other = roundMoney(customTotal);
  for (const item of rule?.customDeductions || []) {
    if (item.enabled === false || !item.name) continue;
    const amount = Number(item.amount || 0) + baseAmount(employee, item.calculationBase, salaryMaster) * asPercent(item.percent, 0);
    custom[item.name] = roundMoney(Number(custom[item.name] || 0) + amount);
    customTotal += amount;
  }

  return {
    pf: roundMoney(pf),
    esi: roundMoney(esi),
    ptax: roundMoney(ptax),
    custom,
    otherDeductions: roundMoney(customTotal),
    total: roundMoney(pf + esi + ptax + customTotal)
  };
}

function calculateCustomEarnings({ employee, rule, salaryMaster }) {
  const custom = {};
  let total = 0;
  for (const item of rule?.customEarnings || []) {
    if (item.enabled === false || !item.name) continue;
    const amount = Number(item.amount || 0) + baseAmount(employee, item.calculationBase, salaryMaster) * asPercent(item.percent, 0);
    custom[item.name] = roundMoney(amount);
    total += amount;
  }
  return { custom, total: roundMoney(total) };
}

function calculateSalary({ employee, attendanceStats, rule, salaryMaster }) {
  const totals = salaryTotals(employee, salaryMaster);
  const gross = roundMoney(totals.gross);
  const workingDays = Math.max(Number(attendanceStats?.workingDays || 0), 1);
  const payableDays = Math.min(Math.max(Number(attendanceStats?.payableDays || 0), 0), workingDays);
  const lopDays = roundMoney(workingDays - payableDays);

  const perDayGross = roundMoney(gross / workingDays);
  const lopAmount = roundMoney(gross * (lopDays / workingDays));

  const waterfall = applyLopWaterfall({ components: totals.earnings, lopAmount, rule });
  const earnings = waterfall.earned;

  // Prorated gross is the SUM of the earned components, so the payslip always
  // foots exactly. It equals gross - lopAmount whenever the LOP fits inside the
  // gross, which is the normal case.
  const proratedGross = roundMoney(
    earnings.basic + earnings.hra + earnings.conveyance + earnings.specialAllowance + earnings.otherEarnings
  );

  const statutoryBasis = rule?.statutoryBasis || 'EARNED';
  // 'EARNED'  -> PF/ESI computed on the post-waterfall (earned) components.
  // 'CONTRACT'-> PF/ESI computed on the full contractual components, ignoring LOP.
  const statutoryEarnings = statutoryBasis === 'CONTRACT' ? totals.earnings : earnings;
  const statutoryGross = statutoryBasis === 'CONTRACT' ? gross : proratedGross;

  const proratedMaster = salaryMaster
    ? {
      ...(salaryMaster.toObject?.() || salaryMaster),
      earnings: statutoryEarnings,
      grossSalary: statutoryGross,
      deductions: masterDeductions(salaryMaster)
    }
    : null;

  const employeeForCalc = {
    ...(employee?.toObject?.() || employee),
    salary: { ...(employee?.salary || {}), basic: statutoryEarnings.basic, gross: statutoryGross }
  };

  const extraEarnings = calculateCustomEarnings({ employee: employeeForCalc, rule, salaryMaster: proratedMaster });
  const deductions = calculateStatutoryDeductions({ employee: employeeForCalc, rule, salaryMaster: proratedMaster });
  const netPay = roundMoney(proratedGross + extraEarnings.total - deductions.total);

  return {
    gross,
    proratedGross,
    basic: earnings.basic,
    hra: earnings.hra,
    conveyance: earnings.conveyance,
    specialAllowance: earnings.specialAllowance,
    otherEarnings: earnings.otherEarnings,
    contractEarnings: totals.earnings,
    customEarnings: extraEarnings.custom,
    deductions,
    netPay,
    lop: {
      days: lopDays,
      perDayGross,
      amount: lopAmount,
      absorbed: waterfall.absorbed,
      unabsorbed: waterfall.unabsorbed,
      order: waterfall.order,
      breakdown: waterfall.breakdown,
      basicProtected: earnings.basic === roundMoney(totals.earnings.basic)
    },
    salaryMasterId: salaryMaster?._id,
    salaryMasterEffectiveMonth: salaryMaster?.effectiveMonth
  };
}

module.exports = {
  calculateSalary,
  calculateStatutoryDeductions,
  applyLopWaterfall,
  resolveWaterfall,
  roundMoney,
  asPercent,
  salaryTotals,
  DEFAULT_LOP_WATERFALL
};
