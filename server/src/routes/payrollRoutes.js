const router = require('express').Router();
const { auth, requireRoles, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/payrollController');

router.get('/public/slips/:id/pdf', controller.publicSlipPdf);

router.use(auth);
router.get('/rules', requireAbility('PAYROLL', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.rules);
router.get('/employees', requireAbility('PAYROLL', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.employees);
router.post('/rules', requireAbility('PAYROLL', 'UPDATE_RULES', 'SUPER_ADMIN', 'HR_ADMIN'), controller.upsertRule);

router.get('/salary-masters/template.xlsx', requireAbility('PAYROLL', 'UPDATE_SALARY_MASTER', 'SUPER_ADMIN', 'HR_ADMIN'), controller.salaryImportTemplate);
router.post('/salary-masters/import-excel', requireAbility('PAYROLL', 'UPDATE_SALARY_MASTER', 'SUPER_ADMIN', 'HR_ADMIN'), controller.importSalaryMastersExcel);
router.get('/salary-masters', requireAbility('PAYROLL', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.salaryMasters);
router.post('/salary-masters', requireAbility('PAYROLL', 'UPDATE_SALARY_MASTER', 'SUPER_ADMIN', 'HR_ADMIN'), controller.upsertSalaryMaster);
router.post('/salary-masters/bulk', requireAbility('PAYROLL', 'UPDATE_SALARY_MASTER', 'SUPER_ADMIN', 'HR_ADMIN'), controller.bulkUpsertSalaryMasters);
router.delete('/salary-masters/:id', requireAbility('PAYROLL', 'UPDATE_SALARY_MASTER', 'SUPER_ADMIN', 'HR_ADMIN'), controller.deleteSalaryMaster);
router.get('/runs', requireAbility('PAYROLL', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.runs);
router.post('/run', requireAbility('PAYROLL', 'RUN', 'SUPER_ADMIN', 'HR_ADMIN'), controller.runPayroll);
router.post('/runs/:runId/release', requireAbility('PAYROLL', 'RUN', 'SUPER_ADMIN', 'HR_ADMIN'), controller.releaseRun);
router.get('/runs/:runId/salary-sheet', requireAbility('PAYROLL', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.salarySheet);
router.get('/runs/:runId/salary-sheet.csv', requireAbility('PAYROLL', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.salarySheetCsv);
router.get('/runs/:runId/salary-sheet.pdf', requireAbility('PAYROLL', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.salarySheetPdf);
router.get('/payslip-template', requireAbility('PAYROLL', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.template);
router.post('/payslip-template', requireAbility('PAYROLL', 'UPDATE_TEMPLATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.saveTemplate);
router.post('/slips/share', requireAbility('PAYROLL', 'SHARE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.shareSlips);
router.post('/slips/:id/adjust', requireAbility('PAYROLL', 'ADJUST', 'SUPER_ADMIN', 'HR_ADMIN'), controller.adjustSlip);
router.get('/slips', controller.slips);
router.get('/slips/:id/pdf', controller.slipPdf);

module.exports = router;
