// IMAGE COMPRESSION & OPTIMIZATION UTILITIES
// Install: npm install sharp

const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

/**
 * Compress and optimize image
 * @param {Buffer} buffer - Image buffer
 * @param {number} maxWidth - Maximum width (default: 800)
 * @param {number} maxHeight - Maximum height (default: 800)
 * @param {number} quality - Quality 1-100 (default: 80)
 * @returns {Promise<Buffer>} - Optimized image buffer
 */
async function optimizeImage(buffer, maxWidth = 800, maxHeight = 800, quality = 80) {
  try {
    return await sharp(buffer)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .png({ quality })
      .toBuffer();
  } catch (err) {
    console.error('Image optimization error:', err);
    return buffer; // Return original if optimization fails
  }
}

/**
 * Create thumbnail from image/PDF
 * @param {Buffer} buffer - Image buffer or PDF buffer
 * @param {string} mimeType - File MIME type
 * @param {number} width - Thumbnail width (default: 200)
 * @param {number} height - Thumbnail height (default: 300)
 * @returns {Promise<Buffer>} - Thumbnail buffer
 */
async function generateThumbnail(buffer, mimeType, width = 200, height = 300) {
  try {
    if (mimeType === 'application/pdf') {
      // For PDF, you would typically use pdf2pic or similar
      // For now, return a placeholder
      console.warn('PDF thumbnail generation requires additional setup (pdf2pic)');
      return null;
    }

    // For images
    return await sharp(buffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 70, progressive: true })
      .toBuffer();
  } catch (err) {
    console.error('Thumbnail generation error:', err);
    return null;
  }
}

/**
 * Compress PDF (if needed)
 * Requires: npm install pdf-lib
 * Note: This is complex, simpler to just store path and serve original
 */
async function getPdfInfo(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const pdfData = await pdfParse(buffer);
    return {
      pages: pdfData.numpages || 0,
      text: pdfData.text ? pdfData.text.substring(0, 500) : '',
      size: buffer.length
    };
  } catch (err) {
    console.error('PDF info extraction error:', err);
    return { pages: 0, text: '', size: buffer.length };
  }
}

/**
 * Get file size in human readable format
 */
function getFileSizeString(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  optimizeImage,
  generateThumbnail,
  getPdfInfo,
  getFileSizeString
};
