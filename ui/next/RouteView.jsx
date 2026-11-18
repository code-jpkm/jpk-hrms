'use client';

/**
 * One place that knows which screen belongs to which page. Each screen is its own
 * download (code splitting) and runs only in the browser: the pages keep the
 * session in localStorage and use window / document freely.
 */
import React from 'react';
import dynamic from 'next/dynamic';
import { RouteSkeleton } from '../components/Loading.jsx';
import PageGuard from './PageGuard.jsx';
import BootScreen from './BootScreen.jsx';

const loading = () => <RouteSkeleton />;
const boot = () => <BootScreen />;

const LoginView = dynamic(() => import('../views/Login.jsx'), { ssr: false, loading: boot });
const ForgotPasswordView = dynamic(() => import('../views/ForgotPassword.jsx'), { ssr: false, loading: boot });
const ResetPasswordView = dynamic(() => import('../views/ResetPassword.jsx'), { ssr: false, loading: boot });
const HomeView = dynamic(() => import('../views/Home.jsx'), { ssr: false, loading });
const DashboardView = dynamic(() => import('../views/Dashboard.jsx'), { ssr: false, loading });
const EmployeesView = dynamic(() => import('../views/Employees.jsx'), { ssr: false, loading });
const RecruitmentView = dynamic(() => import('../views/Recruitment.jsx'), { ssr: false, loading });
const AttendanceView = dynamic(() => import('../views/Attendance.jsx'), { ssr: false, loading });
const AttendanceRulesView = dynamic(() => import('../views/AttendanceRules.jsx'), { ssr: false, loading });
const HierarchyView = dynamic(() => import('../views/Hierarchy.jsx'), { ssr: false, loading });
const ProbationView = dynamic(() => import('../views/Probation.jsx'), { ssr: false, loading });
const AIAssistantView = dynamic(() => import('../views/AIAssistant.jsx'), { ssr: false, loading });
const LeaveView = dynamic(() => import('../views/Leave.jsx'), { ssr: false, loading });
const RegularizationView = dynamic(() => import('../views/Regularization.jsx'), { ssr: false, loading });
const PayrollView = dynamic(() => import('../views/Payroll.jsx'), { ssr: false, loading });
const HolidaysView = dynamic(() => import('../views/Holidays.jsx'), { ssr: false, loading });
const ShiftsView = dynamic(() => import('../views/Shifts.jsx'), { ssr: false, loading });
const AdminAccessView = dynamic(() => import('../views/AdminAccess.jsx'), { ssr: false, loading });
const BirthdaysView = dynamic(() => import('../views/Birthdays.jsx'), { ssr: false, loading });
const BiometricView = dynamic(() => import('../views/Biometric.jsx'), { ssr: false, loading });
const CompanySettingsView = dynamic(() => import('../views/CompanySettings.jsx'), { ssr: false, loading });
const NoticesView = dynamic(() => import('../views/Notices.jsx'), { ssr: false, loading });
const DocumentDesignerView = dynamic(() => import('../views/DocumentDesigner.jsx'), { ssr: false, loading });
const IntegrationsView = dynamic(() => import('../views/Integrations.jsx'), { ssr: false, loading });
const MessageCenterView = dynamic(() => import('../views/MessageCenter.jsx'), { ssr: false, loading });
const AccountView = dynamic(() => import('../views/Account.jsx'), { ssr: false, loading });

const VIEWS = {
  login: LoginView,
  forgotPassword: ForgotPasswordView,
  resetPassword: ResetPasswordView,
  home: HomeView,
  dashboard: DashboardView,
  employees: EmployeesView,
  recruitment: RecruitmentView,
  attendance: AttendanceView,
  attendanceRules: AttendanceRulesView,
  hierarchy: HierarchyView,
  probation: ProbationView,
  ai: AIAssistantView,
  leave: LeaveView,
  regularization: RegularizationView,
  payroll: PayrollView,
  holidays: HolidaysView,
  shifts: ShiftsView,
  access: AdminAccessView,
  birthdays: BirthdaysView,
  biometric: BiometricView,
  settings: CompanySettingsView,
  notices: NoticesView,
  documentStudio: DocumentDesignerView,
  integrations: IntegrationsView,
  messages: MessageCenterView,
  account: AccountView,
};

export default function RouteView({ view, guard }) {
  const View = VIEWS[view];
  if (!View) return null;
  return guard ? <PageGuard path={guard}><View /></PageGuard> : <View />;
}
