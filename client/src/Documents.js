import React from 'react';
import './Documents.css';

function Documents() {
  return (
    <div className="documents-page">
      <div className="documents-header">
        <h1>Documents</h1>
        <p className="documents-subtitle">
          Manage all your uploaded documents in one place
        </p>
      </div>
      <div className="documents-content">
        <div className="documents-placeholder">
          <div className="placeholder-icon">📁</div>
          <h2>Documents Library</h2>
          <p>
            Your uploaded PDFs will appear here. This page will show a searchable
            list of all documents with options to view, rename, or delete.
          </p>
          <p className="placeholder-note">
            Coming in Feature 2: Documents Library
          </p>
        </div>
      </div>
    </div>
  );
}

export default Documents;
