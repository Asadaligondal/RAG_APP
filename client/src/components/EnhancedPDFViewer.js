import React, { useState, useEffect } from 'react';
import './EnhancedPDFViewer.css';

const EnhancedPDFViewer = ({ pdfUrl, title, questions, onClose }) => {
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [highlights, setHighlights] = useState([]);
  const [currentHighlightIndex, setCurrentHighlightIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // Handle overlay click
  const handleOverlayClick = (e) => {
    if (e.target.classList.contains('enhanced-pdf-overlay')) {
      onClose();
    }
  };

  // Handle question selection
  const handleQuestionSelect = (question) => {
    setSelectedQuestion(question);
    
    // Extract highlights from sources with page numbers
    if (question.sources && question.sources.length > 0) {
      const newHighlights = question.sources
        .filter(source => source.pageNumber)
        .map((source, index) => ({
          id: index,
          pageNumber: source.pageNumber,
          text: source.chunk,
          similarity: source.similarity
        }));
      
      setHighlights(newHighlights);
      setCurrentHighlightIndex(0);
      
      // Jump to first highlight page
      if (newHighlights.length > 0) {
        setCurrentPage(newHighlights[0].pageNumber);
      }
    }
  };

  // Navigate to next highlight
  const goToNextHighlight = () => {
    if (highlights.length === 0) return;
    const nextIndex = (currentHighlightIndex + 1) % highlights.length;
    setCurrentHighlightIndex(nextIndex);
    setCurrentPage(highlights[nextIndex].pageNumber);
  };

  // Navigate to previous highlight
  const goToPrevHighlight = () => {
    if (highlights.length === 0) return;
    const prevIndex = currentHighlightIndex === 0 
      ? highlights.length - 1 
      : currentHighlightIndex - 1;
    setCurrentHighlightIndex(prevIndex);
    setCurrentPage(highlights[prevIndex].pageNumber);
  };

  // Update iframe when page changes
  useEffect(() => {
    const iframe = document.getElementById('pdf-iframe');
    if (iframe && currentPage) {
      iframe.src = `${pdfUrl}#page=${currentPage}`;
    }
  }, [currentPage, pdfUrl]);

  return (
    <div className="enhanced-pdf-overlay" onClick={handleOverlayClick}>
      <div className="enhanced-pdf-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="enhanced-pdf-header">
          <h2>{title}</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Main Content */}
        <div className="enhanced-pdf-content">
          {/* Left Sidebar - Questions */}
          <div className="questions-sidebar">
            <h3>Questions ({questions.length})</h3>
            <div className="questions-list">
              {questions.map((q, index) => (
                <div
                  key={index}
                  className={`question-item ${selectedQuestion?.question === q.question ? 'active' : ''}`}
                  onClick={() => handleQuestionSelect(q)}
                >
                  <div className="question-number">Q{index + 1}</div>
                  <div className="question-text">{q.question}</div>
                  {q.sources && (
                    <div className="sources-count">
                      {q.sources.filter(s => s.pageNumber).length} sources
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right Side - PDF Viewer */}
          <div className="pdf-viewer-section">
            {/* Controls */}
            <div className="pdf-controls">
              <div className="page-controls">
                <span>Current Page: {currentPage}</span>
              </div>

              {/* Highlight Navigation */}
              {highlights.length > 0 && (
                <div className="highlight-controls">
                  <button onClick={goToPrevHighlight}>◄</button>
                  <span className="highlight-info">
                    Highlight {currentHighlightIndex + 1} of {highlights.length}
                  </span>
                  <button onClick={goToNextHighlight}>►</button>
                </div>
              )}
            </div>

            {/* PDF Document */}
            <div className="pdf-document-container">
              <iframe
                id="pdf-iframe"
                src={`${pdfUrl}#page=${currentPage}`}
                title={title}
                width="100%"
                height="100%"
                style={{ border: 'none' }}
              />
            </div>

            {/* Current Highlight Info */}
            {highlights.length > 0 && highlights[currentHighlightIndex] && (
              <div className="current-highlight-info">
                <div className="highlight-label">
                  Current Highlight (Page {highlights[currentHighlightIndex].pageNumber})
                </div>
                <div className="highlight-text">
                  {highlights[currentHighlightIndex].text}
                </div>
                <div className="highlight-similarity">
                  {(highlights[currentHighlightIndex].similarity * 100).toFixed(1)}% match
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnhancedPDFViewer;
