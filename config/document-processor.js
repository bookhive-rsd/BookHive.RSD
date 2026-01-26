const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const unzipper = require('unzipper');
const xml2js = require('xml2js');
const sharp = require('sharp');
const { Readable } = require('stream');

/**
 * Extract text from PDF
 */
async function extractPdfText(buffer) {
  try {
    const pdfData = await pdfParse(buffer);
    return {
      text: pdfData.text || '',
      pages: pdfData.numpages || 0,
      metadata: pdfData.info || {}
    };
  } catch (error) {
    console.error('PDF text extraction error:', error);
    return { text: '', pages: 0, metadata: {} };
  }
}

/**
 * Extract text from DOCX (Word Document)
 */
async function extractDocxText(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: result.value || '',
      pages: Math.ceil((result.value || '').length / 3000), // Estimate pages
      metadata: { wordCount: result.value ? result.value.split(/\s+/).length : 0 }
    };
  } catch (error) {
    console.error('DOCX text extraction error:', error);
    return { text: '', pages: 0, metadata: {} };
  }
}

/**
 * Get image metadata
 */
async function getImageMetadata(buffer, mimeType) {
  try {
    const metadata = await sharp(buffer).metadata();
    return {
      text: '', // Images don't have text
      pages: 1,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        space: metadata.space
      }
    };
  } catch (error) {
    console.error('Image metadata extraction error:', error);
    return { text: '', pages: 1, metadata: { format: mimeType } };
  }
}

/**
 * Generate thumbnail from file
 */
async function generateThumbnail(buffer, mimeType, width = 200, height = 300) {
  try {
    if (mimeType === 'application/pdf') {
      // For PDF, create a nice gradient background with PDF icon
      const svgImage = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#ef4444;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#dc2626;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#grad)"/>
        <text x="${width/2}" y="${height/2 + 15}" font-family="Arial, sans-serif" font-size="32" font-weight="bold" fill="white" text-anchor="middle">PDF</text>
      </svg>`;
      return await sharp(Buffer.from(svgImage))
        .png()
        .toBuffer();
    } else if (mimeType.startsWith('image/')) {
      // For images, resize and create thumbnail preserving aspect ratio
      return await sharp(buffer)
        .resize(width, height, { fit: 'cover', position: 'center' })
        .png()
        .toBuffer();
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
               mimeType === 'application/vnd.ms-word.document.macroEnabled.12' ||
               mimeType === 'application/msword') {
      // DOCX thumbnail with Word blue gradient
      const svgImage = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#2563eb;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#1e40af;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#grad)"/>
        <text x="${width/2}" y="${height/2 + 12}" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="white" text-anchor="middle">DOCX</text>
      </svg>`;
      return await sharp(Buffer.from(svgImage))
        .png()
        .toBuffer();
    }
    
    // Fallback thumbnail with gradient
    const svgImage = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#9ca3af;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#6b7280;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grad)"/>
      <text x="${width/2}" y="${height/2 + 10}" font-family="Arial, sans-serif" font-size="24" fill="white" text-anchor="middle">FILE</text>
    </svg>`;
    return await sharp(Buffer.from(svgImage))
      .png()
      .toBuffer();
  } catch (error) {
    console.error('Thumbnail generation error:', error);
    return null;
  }
}

/**
 * Determine file type from MIME type
 */
function getFileTypeFromMime(mimeType) {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/vnd.ms-word.document.macroEnabled.12' ||
      mimeType === 'application/msword') return 'docx';
  if (mimeType.startsWith('image/')) return 'image';
  return null;
}

/**
 * Extract text based on file type
 */
async function extractTextByType(buffer, fileType) {
  switch (fileType) {
    case 'pdf':
      return await extractPdfText(buffer);
    case 'docx':
      return await extractDocxText(buffer);
    case 'image':
      return { text: '', pages: 1, metadata: {} };
    default:
      return { text: '', pages: 0, metadata: {} };
  }
}

/**
 * Validate file content (basic check - can be extended)
 */
async function validateFileContent(buffer, fileType) {
  try {
    const minSize = 100; // Minimum 100 bytes
    if (buffer.length < minSize) {
      return false;
    }

    // Type-specific validation
    switch (fileType) {
      case 'pdf':
        // Check PDF magic number
        return buffer.toString('ascii', 0, 4) === '%PDF';
      case 'docx':
        // DOCX is a ZIP file, check for PK header
        return buffer[0] === 0x50 && buffer[1] === 0x4B;
      case 'image':
        // Basic image validation - check for common image signatures
        return (buffer[0] === 0xFF && buffer[1] === 0xD8) ||  // JPEG
               (buffer[0] === 0x89 && buffer[1] === 0x50) ||  // PNG
               (buffer[0] === 0x47 && buffer[1] === 0x49) ||  // GIF
               (buffer[0] === 0x52 && buffer[1] === 0x49);    // WebP
      default:
        return true;
    }
  } catch (error) {
    console.error('File validation error:', error);
    return false;
  }
}

module.exports = {
  extractPdfText,
  extractDocxText,
  getImageMetadata,
  generateThumbnail,
  getFileTypeFromMime,
  extractTextByType,
  validateFileContent
};
