/**
 * PDF Image Extraction & Upload Utility
 * Extracts images from PDF files and uploads them to Firebase Storage
 */

import * as pdfjsLib from 'pdfjs-dist';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Configure PDF.js worker - use local worker from node_modules
pdfjsLib.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdf.worker.min.js`;

/**
 * Extracts images from a PDF file and uploads them to Firebase Storage
 * @param {File} file - The PDF file to process
 * @param {string} chatId - The chat ID to organize images
 * @returns {Promise<Array>} Array of objects containing imageUrl, pageNumber, storagePath
 */
export async function extractImagesAndUpload(file, chatId) {
  try {
    console.log(`[PDF Extractor] Starting extraction for ${file.name} (chatId: ${chatId})`);
    
    // Load the PDF document
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    console.log(`[PDF Extractor] PDF loaded. Total pages: ${pdf.numPages}`);
    
    const extractedImages = [];
    
    // Process each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      console.log(`[PDF Extractor] Processing page ${pageNum}/${pdf.numPages}`);
      
      const page = await pdf.getPage(pageNum);
      
      // Try to extract images from page operations
      const images = await extractImagesFromPage(page, pageNum, chatId);
      
      if (images.length > 0) {
        extractedImages.push(...images);
        console.log(`[PDF Extractor] Found ${images.length} image(s) on page ${pageNum}`);
      } else {
        // Fallback: Render the entire page as an image if it might contain visual content
        const pageImage = await renderPageAsImage(page, pageNum, chatId);
        if (pageImage) {
          extractedImages.push(pageImage);
          console.log(`[PDF Extractor] Rendered page ${pageNum} as full-page image`);
        }
      }
    }
    
    console.log(`[PDF Extractor] Extraction complete. Total images: ${extractedImages.length}`);
    return extractedImages;
    
  } catch (error) {
    console.error('[PDF Extractor] Error extracting images:', error);
    throw error;
  }
}

/**
 * Attempts to extract embedded images from a PDF page
 */
async function extractImagesFromPage(page, pageNum, chatId) {
  const images = [];
  
  try {
    const operatorList = await page.getOperatorList();
    
    // Look for image operations in the PDF
    for (let i = 0; i < operatorList.fnArray.length; i++) {
      const op = operatorList.fnArray[i];
      
      // Check if operation is an image (paintImageXObject, paintInlineImageXObject, etc.)
      if (op === pdfjsLib.OPS.paintImageXObject || op === pdfjsLib.OPS.paintInlineImageXObject) {
        try {
          // This is a simplified approach - in production, you'd extract the actual image data
          // For now, we'll use the page rendering approach as it's more reliable
          break;
        } catch (err) {
          console.warn(`[PDF Extractor] Error extracting image from page ${pageNum}:`, err);
        }
      }
    }
  } catch (error) {
    console.warn(`[PDF Extractor] Could not extract images from page ${pageNum}:`, error);
  }
  
  return images;
}

/**
 * Renders a PDF page as a high-resolution image
 */
async function renderPageAsImage(page, pageNum, chatId) {
  try {
    // Get page dimensions
    const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for better quality
    
    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    // Render page to canvas
    const renderContext = {
      canvasContext: context,
      viewport: viewport
    };
    
    await page.render(renderContext).promise;
    
    // Convert canvas to blob
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/png', 0.95);
    });
    
    if (!blob) {
      console.warn(`[PDF Extractor] Failed to create blob for page ${pageNum}`);
      return null;
    }
    
    // Upload to Firebase Storage
    const storagePath = `chat-images/${chatId}/page-${pageNum}.png`;
    const storageRef = ref(storage, storagePath);
    
    console.log(`[PDF Extractor] Uploading page ${pageNum} to Firebase Storage...`);
    await uploadBytes(storageRef, blob, {
      contentType: 'image/png',
      customMetadata: {
        pageNumber: pageNum.toString(),
        chatId: chatId,
        extractedAt: new Date().toISOString()
      }
    });
    
    // Get download URL
    const imageUrl = await getDownloadURL(storageRef);
    
    console.log(`[PDF Extractor] Page ${pageNum} uploaded successfully: ${imageUrl}`);
    
    return {
      imageUrl,
      pageNumber: pageNum,
      storagePath
    };
    
  } catch (error) {
    console.error(`[PDF Extractor] Error rendering page ${pageNum}:`, error);
    return null;
  }
}

/**
 * Helper function to check if a page likely contains significant visual content
 * (charts, graphs, diagrams) vs. just text
 */
async function pageHasSignificantImages(page) {
  try {
    const operatorList = await page.getOperatorList();
    let imageCount = 0;
    
    for (let i = 0; i < operatorList.fnArray.length; i++) {
      const op = operatorList.fnArray[i];
      if (op === pdfjsLib.OPS.paintImageXObject || op === pdfjsLib.OPS.paintInlineImageXObject) {
        imageCount++;
      }
    }
    
    // If page has multiple images or any images, consider it significant
    return imageCount > 0;
  } catch (error) {
    // If we can't determine, assume it might have images
    return true;
  }
}

/**
 * Delete all images for a specific chat from Firebase Storage
 * Useful for cleanup when a chat is deleted
 */
export async function deleteImagesForChat(chatId) {
  try {
    const { listAll, deleteObject } = await import('firebase/storage');
    const folderRef = ref(storage, `chat-images/${chatId}`);
    
    const result = await listAll(folderRef);
    
    const deletePromises = result.items.map(item => deleteObject(item));
    await Promise.all(deletePromises);
    
    console.log(`[PDF Extractor] Deleted ${result.items.length} images for chat ${chatId}`);
  } catch (error) {
    console.error(`[PDF Extractor] Error deleting images for chat ${chatId}:`, error);
    throw error;
  }
}
