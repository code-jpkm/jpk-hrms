/**
 * Starter layouts. Creating a template of any type gives the user a complete,
 * correct document they can immediately preview and then drag around — rather
 * than an empty page and a shrug.
 *
 * Coordinates are PDF points on A4 (595.28 x 841.89), left/right margin 40,
 * so the usable content width is 515.
 */

const TEMPLATE_TYPES = [
  { value: 'PAYSLIP', label: 'Salary Slip', icon: 'Wallet' },
  { value: 'OFFER_LETTER', label: 'Offer Letter', icon: 'FileText' },
  { value: 'JOINING_LETTER', label: 'Joining Letter', icon: 'UserPlus' },
  { value: 'APPOINTMENT_LETTER', label: 'Appointment Letter', icon: 'FileText' },
  { value: 'CONFIRMATION_LETTER', label: 'Confirmation Letter', icon: 'CheckCircle2' },
  { value: 'SHOW_CAUSE', label: 'Show Cause Notice', icon: 'AlertTriangle' },
  { value: 'WARNING_LETTER', label: 'Warning Letter', icon: 'AlertTriangle' },
  { value: 'TERMINATION_LETTER', label: 'Termination Letter', icon: 'UserMinus' },
  { value: 'EXPERIENCE_LETTER', label: 'Experience Letter', icon: 'FileText' },
  { value: 'RELIEVING_LETTER', label: 'Relieving Letter', icon: 'FileText' },
  { value: 'SALARY_CERTIFICATE', label: 'Salary Certificate', icon: 'FileText' },
  { value: 'INCREMENT_LETTER', label: 'Increment Letter', icon: 'TrendingUp' },
  { value: 'NOC', label: 'No Objection Certificate', icon: 'ShieldCheck' },
  { value: 'CUSTOM', label: 'Custom Document', icon: 'Sparkles' }
];

const M = 40;
const W = 515;
let seq = 0;
const id = () => `blk_${Date.now().toString(36)}_${(seq += 1)}`;

const letterhead = (companyName, accent = '#1F3445') => ([
  { id: id(), kind: 'TEXT', x: M, y: 34, w: W, h: 26, text: companyName || '{{company.name}}', fontSize: 19, bold: true, align: 'center', color: accent },
  { id: id(), kind: 'TEXT', x: M, y: 60, w: W, h: 30, text: '{{company.address}}', fontSize: 9, align: 'center', color: '#6b7280' },
  { id: id(), kind: 'DIVIDER', x: M, y: 96, w: W, h: 1, borderColor: accent, borderWidth: 1.5 }
]);

const signOff = (y) => ([
  { id: id(), kind: 'TEXT', x: M, y, w: 300, h: 16, text: 'Yours sincerely,', fontSize: 11 },
  { id: id(), kind: 'SIGNATURE', x: M, y: y + 20, w: 220, h: 52, text: 'Authorised Signatory  |  {{company.name}}', fontSize: 9 }
]);

const bodyLetter = ({ companyName, title, salutation = 'Dear {{employee.fullName}},', paragraphs, showFacts = true, accent }) => {
  const blocks = [...letterhead(companyName, accent)];
  blocks.push({ id: id(), kind: 'HEADING', x: M, y: 118, w: W, h: 26, text: title, fontSize: 15, bold: true, align: 'center', color: '#111827' });
  blocks.push({ id: id(), kind: 'TEXT', x: M, y: 152, w: 240, h: 14, text: 'Ref: {{employee.code}}', fontSize: 9, color: '#6b7280' });
  blocks.push({ id: id(), kind: 'TEXT', x: M + 275, y: 152, w: 240, h: 14, text: 'Date: {{date.today}}', fontSize: 9, align: 'right', color: '#6b7280' });
  blocks.push({ id: id(), kind: 'TEXT', x: M, y: 182, w: W, h: 16, text: salutation, fontSize: 11, bold: true });

  let y = 208;
  paragraphs.forEach((p) => {
    const h = Math.max(38, Math.ceil(p.length / 95) * 15 + 16);
    blocks.push({ id: id(), kind: 'TEXT', x: M, y, w: W, h, text: p, fontSize: 10.5, align: 'justify', lineGap: 3 });
    y += h + 8;
  });

  if (showFacts) {
    blocks.push({
      id: id(), kind: 'FIELD_GRID', x: M, y, w: W, h: 96, fontSize: 10,
      background: '#f9fafb', padding: 10, borderColor: '#e5e7eb', borderWidth: 0.8,
      fields: [
        { label: 'Employee Code', value: '{{employee.code}}' },
        { label: 'Designation', value: '{{employee.designation}}' },
        { label: 'Department', value: '{{employee.department}}' },
        { label: 'Date of Joining', value: '{{employee.dateOfJoining}}' }
      ]
    });
    y += 110;
  }

  blocks.push(...signOff(y + 10));
  return blocks;
};

function payslipBlocks(companyName) {
  const accent = '#1F3445';
  return [
    { id: id(), kind: 'TEXT', x: 0, y: 0, w: 595, h: 74, text: '', background: accent },
    { id: id(), kind: 'TEXT', x: M, y: 20, w: W, h: 24, text: companyName || '{{company.name}}', fontSize: 18, bold: true, align: 'center', color: '#ffffff' },
    { id: id(), kind: 'TEXT', x: M, y: 46, w: W, h: 16, text: '{{company.address}}', fontSize: 8.5, align: 'center', color: '#dbeafe' },
    { id: id(), kind: 'HEADING', x: M, y: 92, w: W, h: 24, text: 'SALARY SLIP  ·  {{slip.month}}', fontSize: 14, bold: true, align: 'center', color: '#111827' },
    {
      id: id(), kind: 'FIELD_GRID', x: M, y: 128, w: 250, h: 92, fontSize: 9.5,
      fields: [
        { label: 'Employee', value: '{{employee.fullName}}' },
        { label: 'Code', value: '{{employee.code}}' },
        { label: 'Designation', value: '{{employee.designation}}' },
        { label: 'Department', value: '{{employee.department}}' }
      ]
    },
    {
      id: id(), kind: 'FIELD_GRID', x: M + 265, y: 128, w: 250, h: 92, fontSize: 9.5,
      fields: [
        { label: 'Working Days', value: '{{slip.workingDays}}' },
        { label: 'Payable Days', value: '{{slip.payableDays}}' },
        { label: 'Loss of Pay', value: '{{slip.lopDays}}' },
        { label: 'Bank A/C', value: '{{employee.bankLast4}}' }
      ]
    },
    { id: id(), kind: 'DIVIDER', x: M, y: 232, w: W, h: 1, borderColor: '#e5e7eb', borderWidth: 1 },
    { id: id(), kind: 'EARNINGS_TABLE', x: M, y: 246, w: W, h: 260, fontSize: 9.5, borderColor: accent },
    { id: id(), kind: 'TEXT', x: M, y: 700, w: W, h: 30, text: 'This is a computer-generated salary slip and does not require a signature.', fontSize: 8, align: 'center', color: '#9ca3af' }
  ];
}

function starterTemplate(type, tenant) {
  const companyName = tenant?.name || '{{company.name}}';
  const base = { pageSize: 'A4', orientation: 'portrait', margins: { top: M, right: M, bottom: M, left: M } };

  switch (type) {
    case 'PAYSLIP':
      return { ...base, name: 'Salary Slip Format', description: 'Default payslip with earnings, deductions and LOP breakdown.', blocks: payslipBlocks(companyName) };

    case 'OFFER_LETTER':
      return { ...base, name: 'Offer Letter', blocks: bodyLetter({ companyName, title: 'LETTER OF OFFER', salutation: 'Dear {{employee.fullName}},', paragraphs: [
        'We are delighted to offer you the position of {{employee.designation}} in our {{employee.department}} department at {{company.name}}. This offer is made on the basis of your qualifications, experience and the discussions held during the selection process.',
        'Your annual gross remuneration will be Rs. {{employee.grossSalary}}, structured in accordance with company policy. A detailed breakdown of your salary components will be provided in your appointment letter.',
        'Your expected date of joining is {{employee.dateOfJoining}}. This offer remains subject to satisfactory verification of the documents and references you have provided.',
        'Please confirm your acceptance by signing and returning a copy of this letter. We look forward to welcoming you to the team.'
      ] }) };

    case 'JOINING_LETTER':
      return { ...base, name: 'Joining Letter', blocks: bodyLetter({ companyName, title: 'JOINING LETTER', paragraphs: [
        'This is to confirm that you have joined {{company.name}} as {{employee.designation}} in the {{employee.department}} department with effect from {{employee.dateOfJoining}}.',
        'Your employee code is {{employee.code}}. Please use this reference for all official correspondence, attendance and payroll matters.',
        'You are required to comply with the company policies, code of conduct and confidentiality obligations communicated to you at the time of onboarding.'
      ] }) };

    case 'APPOINTMENT_LETTER':
      return { ...base, name: 'Appointment Letter', blocks: bodyLetter({ companyName, title: 'LETTER OF APPOINTMENT', paragraphs: [
        'With reference to your application and the subsequent interview, we are pleased to appoint you as {{employee.designation}} in the {{employee.department}} department at {{company.name}}, effective {{employee.dateOfJoining}}.',
        'Your gross remuneration will be Rs. {{employee.grossSalary}} per annum. Statutory deductions including Provident Fund, ESI and Professional Tax will apply as per prevailing law.',
        'Your appointment is subject to the terms and conditions of service in force, which may be amended by the management from time to time.'
      ] }) };

    case 'CONFIRMATION_LETTER':
      return { ...base, name: 'Confirmation Letter', blocks: bodyLetter({ companyName, title: 'CONFIRMATION OF EMPLOYMENT', paragraphs: [
        'We are pleased to inform you that, based on a review of your performance during the probation period, your services with {{company.name}} are hereby confirmed with effect from {{date.today}}.',
        'You will continue to serve as {{employee.designation}} in the {{employee.department}} department. All other terms and conditions of your employment remain unchanged.',
        'We appreciate your contribution and look forward to your continued association with the organisation.'
      ] }) };

    case 'SHOW_CAUSE':
      return { ...base, name: 'Show Cause Notice', blocks: bodyLetter({ companyName, accent: '#A45210', title: 'SHOW CAUSE NOTICE', paragraphs: [
        'It has been brought to the notice of the management that you have been found in breach of the following: [DESCRIBE THE INCIDENT, WITH DATES AND SPECIFIC CONDUCT]. This conduct is in violation of the company policy and the terms of your employment.',
        'You are hereby called upon to show cause in writing, within 48 hours of receipt of this notice, as to why disciplinary action should not be initiated against you in this matter.',
        'Should no reply be received within the stipulated period, the management will be constrained to proceed on the basis of the material on record, without further reference to you.',
        'This notice is issued without prejudice to any other right or remedy available to the company.'
      ] }) };

    case 'WARNING_LETTER':
      return { ...base, name: 'Warning Letter', blocks: bodyLetter({ companyName, accent: '#C4620E', title: 'LETTER OF WARNING', paragraphs: [
        'This letter serves as a formal warning regarding: [DESCRIBE THE CONDUCT AND THE DATES CONCERNED].',
        'Your explanation dated [DATE] has been considered and is not found satisfactory. You are advised to ensure that such conduct is not repeated.',
        'Please note that any recurrence will invite serious disciplinary action, which may include termination of your services. A copy of this letter is being placed in your personal file.'
      ] }) };

    case 'TERMINATION_LETTER':
      return { ...base, name: 'Termination Letter', blocks: bodyLetter({ companyName, accent: '#A45210', title: 'TERMINATION OF EMPLOYMENT', paragraphs: [
        'With reference to the disciplinary proceedings initiated against you and the show cause notice dated [DATE], the management has concluded that the charges stand established.',
        'Accordingly, your services with {{company.name}} stand terminated with effect from [DATE]. You are required to hand over all company property, documents and data in your possession to the HR department.',
        'Your full and final settlement will be processed in accordance with company policy and applicable law.'
      ] }) };

    case 'EXPERIENCE_LETTER':
      return { ...base, name: 'Experience Letter', blocks: bodyLetter({ companyName, title: 'EXPERIENCE CERTIFICATE', salutation: 'TO WHOMSOEVER IT MAY CONCERN', paragraphs: [
        'This is to certify that {{employee.fullName}} (Employee Code: {{employee.code}}) was employed with {{company.name}} from {{employee.dateOfJoining}} to [LAST WORKING DATE].',
        'At the time of leaving, {{employee.fullName}} was serving as {{employee.designation}} in the {{employee.department}} department.',
        'During the tenure with us, we found the conduct and performance to be satisfactory. We wish {{employee.fullName}} every success in future endeavours.'
      ] }) };

    case 'RELIEVING_LETTER':
      return { ...base, name: 'Relieving Letter', blocks: bodyLetter({ companyName, title: 'RELIEVING LETTER', paragraphs: [
        'This is to confirm that your resignation from the post of {{employee.designation}} has been accepted and you have been relieved from the services of {{company.name}} at the close of business hours on [LAST WORKING DATE].',
        'You have handed over the charge and all company property in your possession. Your full and final settlement will be processed as per company policy.',
        'We thank you for your services and wish you the very best.'
      ] }) };

    case 'SALARY_CERTIFICATE':
      return { ...base, name: 'Salary Certificate', blocks: bodyLetter({ companyName, title: 'SALARY CERTIFICATE', salutation: 'TO WHOMSOEVER IT MAY CONCERN', paragraphs: [
        'This is to certify that {{employee.fullName}} (Employee Code: {{employee.code}}) is employed with {{company.name}} as {{employee.designation}} in the {{employee.department}} department since {{employee.dateOfJoining}}.',
        'The current gross remuneration drawn is Rs. {{employee.grossSalary}}, subject to statutory deductions as applicable.',
        'This certificate is issued on request for the purpose stated by the employee and carries no financial obligation on the part of the company.'
      ] }) };

    case 'INCREMENT_LETTER':
      return { ...base, name: 'Increment Letter', blocks: bodyLetter({ companyName, title: 'SALARY REVISION', paragraphs: [
        'In recognition of your performance and contribution during the review period, we are pleased to inform you that your compensation has been revised with effect from [EFFECTIVE DATE].',
        'Your revised gross remuneration will be Rs. {{employee.grossSalary}}. The revised component-wise structure is reflected in your salary master and will appear in your next salary slip.',
        'All other terms and conditions of your employment remain unchanged. We congratulate you and look forward to your continued contribution.'
      ] }) };

    case 'NOC':
      return { ...base, name: 'No Objection Certificate', blocks: bodyLetter({ companyName, title: 'NO OBJECTION CERTIFICATE', salutation: 'TO WHOMSOEVER IT MAY CONCERN', paragraphs: [
        'This is to certify that {{employee.fullName}} (Employee Code: {{employee.code}}), presently working as {{employee.designation}} in the {{employee.department}} department, has been employed with {{company.name}} since {{employee.dateOfJoining}}.',
        'The company has no objection to the said employee for the purpose of [STATE PURPOSE — VISA / PASSPORT / HIGHER STUDIES / LOAN].',
        'This certificate is issued on request and does not constitute any financial commitment by the company.'
      ] }) };

    default:
      return {
        ...base,
        name: 'Custom Document',
        blocks: [
          ...letterhead(companyName),
          { id: id(), kind: 'HEADING', x: M, y: 120, w: W, h: 26, text: 'DOCUMENT TITLE', fontSize: 15, bold: true, align: 'center' },
          { id: id(), kind: 'TEXT', x: M, y: 165, w: W, h: 120, text: 'Start typing here. Use the token picker to insert live data such as {{employee.fullName}} or {{date.today}}.', fontSize: 10.5, align: 'justify', lineGap: 3 },
          ...signOff(320)
        ]
      };
  }
}

module.exports = { starterTemplate, TEMPLATE_TYPES };
