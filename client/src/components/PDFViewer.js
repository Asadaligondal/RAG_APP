import React from 'react';
import './PDFViewer.css';

const PDFViewer = ({ pdfUrl, title, onClose }) => {
  if (!pdfUrl) return null;

  return (
    <div className="pdf-viewer-overlay" onClick={onClose}>
      <div className="pdf-viewer-container" onClick={(e) => e.stopPropagation()}>
        <div className="pdf-viewer-header">
          <h3>{title || 'PDF Preview'}</h3>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="pdf-viewer-content">
          <iframe
            src={pdfUrl}
            width="100%"
            height="100%"
            title={`PDF Viewer - ${title}`}
            frameBorder="0"
          />
        </div>
      </div>
    </div>
  );
};

export default PDFViewer;
