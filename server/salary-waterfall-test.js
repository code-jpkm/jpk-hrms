const { calculateSalary } = require('./src/utils/salary.js');
const rule = { pf:{enabled:true,employeePercent:12,wageCap:15000,calculationBase:'BASIC'}, esi:{enabled:true,employeePercent:0.75,grossCap:21000}, ptax:{enabled:true,slabs:[{from:0,to:10000,amount:0},{from:10001,to:15000,amount:110},{from:15001,to:25000,amount:130},{from:25001,to:40000,amount:150}],defaultAmount:200} };
const master = { calculationMode:'RULE_BASED_DEDUCTIONS', earnings:{basic:15000,hra:6000,conveyance:1600,specialAllowance:2400,otherEarnings:1000}, grossSalary:26000, deductions:{otherDeductions:0} };
const emp = { salary:{}, statutory:{pfApplicable:true,esiApplicable:true,ptaxApplicable:true} };

function show(label, lopDays, workingDays){
  const stats = { workingDays, payableDays: workingDays - lopDays };
  const r = calculateSalary({ employee: emp, attendanceStats: stats, rule, salaryMaster: master });
  console.log(`\n--- ${label} (LOP ${lopDays}d of ${workingDays}) ---`);
  console.log(`LOP value  : ${r.lop.amount}  (perDay ${r.lop.perDayGross})`);
  console.log(`Basic      : ${r.basic}  (contract ${r.contractEarnings.basic})  protected=${r.lop.basicProtected}`);
  console.log(`HRA        : ${r.hra}`);
  console.log(`Conveyance : ${r.conveyance}`);
  console.log(`Special    : ${r.specialAllowance}`);
  console.log(`Other      : ${r.otherEarnings}`);
  console.log(`Earned Gross: ${r.proratedGross}  (check ${r.gross} - ${r.lop.amount} = ${(r.gross-r.lop.amount).toFixed(2)})`);
  console.log('Waterfall  :', r.lop.breakdown.map(b=>`${b.component}-${b.deducted}`).join(' -> ')||'none');
  console.log(`PF ${r.deductions.pf} | ESI ${r.deductions.esi} | PTax ${r.deductions.ptax} | NET ${r.netPay}`);
}
show('No LOP', 0, 26);
show('Half day', 0.5, 26);
show('2 days', 2, 26);
show('Special exhausted', 4, 26);
show('Eats into Basic', 20, 26);
