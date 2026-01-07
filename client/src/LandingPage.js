import React from 'react';
import { Link } from 'react-router-dom';
import './LandingPage.css';

function LandingPage() {
  return (
    <div className="landing-page">
      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-container">
          <h1 className="logo">DocuBrain</h1>
          <Link to="/dashboard" className="login-btn">Login</Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-content">
          <h1 className="hero-title">Chat with your PDF Documents in Seconds</h1>
          <p className="hero-subtitle">
            AI-powered analysis for your contracts, resumes, and reports. 
            Get instant answers from your documents with cutting-edge RAG technology.
          </p>
          <Link to="/dashboard" className="cta-button">Get Started for Free</Link>
        </div>
      </section>

      {/* Features Section */}
      <section className="features">
        <h2 className="features-title">Why Choose DocuBrain?</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">⚡</div>
            <h3>Instant Answers</h3>
            <p>Get intelligent responses from your documents in seconds, powered by advanced AI.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔒</div>
            <h3>Secure Uploads</h3>
            <p>Your documents are processed securely with enterprise-grade encryption.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🎯</div>
            <h3>Smart Citations</h3>
            <p>Every answer includes source references so you can verify the information.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <p>&copy; 2026 DocuBrain. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default LandingPage;