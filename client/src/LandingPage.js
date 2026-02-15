import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Zap, Shield, Quote } from 'lucide-react';
import './LandingPage.css';

function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="landing-page">
      <nav className="landing-navbar">
        <div className="landing-nav-container">
          <Link to="/" className="landing-logo">DocuBrain</Link>
          <div className="landing-nav-right">
            <Link to={user ? "/dashboard" : "/login"} className="landing-nav-btn">
              {user ? "Dashboard" : "Log in"}
            </Link>
          </div>
        </div>
      </nav>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-hero-content">
            <h1 className="landing-hero-title">
              Chat with your PDF documents in seconds
            </h1>
            <p className="landing-hero-subtitle">
              AI-powered analysis for contracts, resumes, and reports.
              Get instant answers with cutting-edge RAG technology.
            </p>
            <Link to={user ? "/dashboard" : "/signup"} className="landing-cta">
              {user ? "Go to Dashboard" : "Get started free"}
            </Link>
          </div>
        </section>

        <section className="landing-features">
          <h2 className="landing-features-title">Why DocuBrain?</h2>
          <div className="landing-features-grid">
            <div className="landing-feature-card">
              <div className="landing-feature-icon">
                <Zap size={24} strokeWidth={2} />
              </div>
              <h3>Instant answers</h3>
              <p>Get intelligent responses from your documents in seconds, powered by advanced AI.</p>
            </div>
            <div className="landing-feature-card">
              <div className="landing-feature-icon">
                <Shield size={24} strokeWidth={2} />
              </div>
              <h3>Secure uploads</h3>
              <p>Your documents are processed securely with enterprise-grade encryption.</p>
            </div>
            <div className="landing-feature-card">
              <div className="landing-feature-icon">
                <Quote size={24} strokeWidth={2} />
              </div>
              <h3>Smart citations</h3>
              <p>Every answer includes source references so you can verify the information.</p>
            </div>
          </div>
        </section>

        <footer className="landing-footer">
          <p>&copy; 2026 DocuBrain. All rights reserved.</p>
        </footer>
      </main>
    </div>
  );
}

export default LandingPage;
