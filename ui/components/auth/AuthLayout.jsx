import React from 'react';
import DayScene from '../DayScene.jsx';
import '../../styles/login.css';

/** Sign-in screens sit on the live time-of-day landscape. */
export default function AuthLayout({ title, subtitle, children, footer = 'Attendance · Leave · Payroll · Recruitment' }) {
  return (
    <div className="jpk-auth">
      <DayScene variant="hero" className="jpk-auth-scene" />
      <main className="jpk-auth-center">
        <section className="jpk-auth-card">
          <header className="jpk-auth-head">
            <img src="/brand/jpk-logo.png" alt="JPK Metallics" />
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </header>
          {children}
        </section>
        {footer && <footer className="jpk-auth-foot">{footer}</footer>}
      </main>
    </div>
  );
}
