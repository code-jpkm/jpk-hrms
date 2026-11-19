import React from 'react';
import DayScene from '../DayScene.jsx';
import WeatherBadge from '../WeatherBadge.jsx';
import '../../styles/login.css';

/** Sign-in screens sit on the live time-of-day landscape, with the weather at the office. */
export default function AuthLayout({ title, subtitle, children, footer = 'Attendance · Leave · Payroll · Recruitment' }) {
  return (
    <div className="jpk-auth">
      <DayScene variant="hero" className="jpk-auth-scene" weather="public" />
      <WeatherBadge variant="chip" mode="public" className="jpk-auth-weather on-scene" />
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
