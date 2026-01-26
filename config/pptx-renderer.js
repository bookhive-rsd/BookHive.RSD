/**
 * PPTX Renderer - Server-side PPTX to Image conversion
 * Converts PowerPoint presentations to high-quality PNG images of slides
 */

const fs = require('fs').promises;
const path = require('path');
const { Canvas, Image } = require('canvas');
const JSZip = require('jszip');

/**
 * Convert PPTX buffer to slide images
 * Returns array of base64 encoded PNG images
 */
async function convertPptxToImages(buffer) {
    try {
        console.log('[PPTX Renderer] Starting PPTX conversion, buffer size:', buffer.byteLength);
        
        const zip = new JSZip();
        await zip.loadAsync(buffer);
        console.log('[PPTX Renderer] Successfully loaded ZIP');
        
        const slides = [];
        
        // Get slide files
        const slideFiles = Object.keys(zip.files)
            .filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
            .sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)[0]);
                const numB = parseInt(b.match(/\d+/)[0]);
                return numA - numB;
            });
        
        console.log('[PPTX Renderer] Found slide files:', slideFiles.length);
        
        if (slideFiles.length === 0) {
            throw new Error('No slides found in PPTX file');
        }
        
        // Get presentation dimensions
        let slideWidth = 960;
        let slideHeight = 720;
        
        try {
            const presXml = await zip.file('ppt/presentation.xml').async('text');
            const sldSzMatch = presXml.match(/<p:sldSz\s+[^>]*cx="(\d+)"[^>]*cy="(\d+)"[^>]*>/);
            if (sldSzMatch) {
                const emuToPixels = 96 / 914400; // EMU to pixels conversion
                slideWidth = Math.round(parseInt(sldSzMatch[1]) * emuToPixels);
                slideHeight = Math.round(parseInt(sldSzMatch[2]) * emuToPixels);
                console.log('[PPTX Renderer] Slide dimensions:', slideWidth, 'x', slideHeight);
            }
        } catch (e) {
            console.warn('[PPTX Renderer] Could not determine slide dimensions, using defaults');
        }
        
        // Process each slide
        for (let i = 0; i < slideFiles.length; i++) {
            const slideFile = slideFiles[i];
            const slideNum = i + 1;
            
            try {
                const slideXml = await zip.file(slideFile).async('text');
                console.log(`[PPTX Renderer] Processing slide ${slideNum}/${slideFiles.length}`);
                
                // Extract text content
                const textContent = extractSlideText(slideXml, zip, slideFile);
                
                // Create canvas
                const canvas = new Canvas(slideWidth, slideHeight);
                const ctx = canvas.getContext('2d');
                
                // Draw slide background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, slideWidth, slideHeight);
                
                // Draw border
                ctx.strokeStyle = '#e5e7eb';
                ctx.lineWidth = 1;
                ctx.strokeRect(0, 0, slideWidth, slideHeight);
                
                // Render slide content
                renderSlideContent(ctx, slideXml, slideWidth, slideHeight);
                
                // Draw text content if extracted
                if (textContent && textContent.trim().length > 0) {
                    renderTextContent(ctx, textContent, slideWidth, slideHeight);
                }
                
                // Add slide number
                ctx.fillStyle = '#9ca3af';
                ctx.font = '12px Poppins, sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(`${slideNum}/${slideFiles.length}`, slideWidth - 15, slideHeight - 15);
                ctx.textAlign = 'left';
                
                // Convert to PNG
                const pngBuffer = canvas.toBuffer('image/png');
                const base64 = pngBuffer.toString('base64');
                
                slides.push({
                    slideNum: slideNum,
                    image: `data:image/png;base64,${base64}`,
                    textContent: textContent
                });
                
                console.log(`[PPTX Renderer] Successfully rendered slide ${slideNum}`);
                
            } catch (err) {
                console.error(`[PPTX Renderer] Error rendering slide ${slideNum}:`, err.message);
                
                // Create error slide
                const errorCanvas = new Canvas(slideWidth, slideHeight);
                const errorCtx = errorCanvas.getContext('2d');
                errorCtx.fillStyle = '#fff3cd';
                errorCtx.fillRect(0, 0, slideWidth, slideHeight);
                errorCtx.strokeStyle = '#ffc107';
                errorCtx.lineWidth = 2;
                errorCtx.strokeRect(0, 0, slideWidth, slideHeight);
                
                errorCtx.fillStyle = '#856404';
                errorCtx.font = 'bold 16px Poppins, sans-serif';
                errorCtx.fillText(`Slide ${slideNum} - Unable to render`, 15, 50);
                errorCtx.font = '12px Poppins, sans-serif';
                errorCtx.fillText(err.message.substring(0, 80), 15, 80);
                
                const errorBuffer = errorCanvas.toBuffer('image/png');
                const errorBase64 = errorBuffer.toString('base64');
                
                slides.push({
                    slideNum: slideNum,
                    image: `data:image/png;base64,${errorBase64}`,
                    textContent: ''
                });
            }
        }
        
        console.log('[PPTX Renderer] Conversion complete:', slides.length, 'slides');
        return slides;
        
    } catch (err) {
        console.error('[PPTX Renderer] Fatal error:', err);
        throw err;
    }
}

/**
 * Render slide content from XML
 */
function renderSlideContent(ctx, slideXml, width, height) {
    try {
        // Extract shape backgrounds and positions
        const shapeMatches = slideXml.match(/<p:sp[^>]*>[\s\S]*?<\/p:sp>/g) || [];
        
        for (const shapeXml of shapeMatches) {
            renderShape(ctx, shapeXml, width, height);
        }
        
    } catch (err) {
        console.warn('[PPTX Renderer] Error rendering slide content:', err.message);
    }
}

/**
 * Render individual shape
 */
function renderShape(ctx, shapeXml, width, height) {
    try {
        // Extract fill color
        const solidFillMatch = shapeXml.match(/<a:solidFill[^>]*>.*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})".*?<\/a:solidFill>/s);
        const fillColor = solidFillMatch ? '#' + solidFillMatch[1] : null;
        
        // Extract position and size from transform
        const transformMatch = shapeXml.match(/<p:xfrm[^>]*>[\s\S]*?<a:off\s+x="(\d+)"\s+y="(\d+)"[^>]*>[\s\S]*?<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/);
        if (!transformMatch) return;
        
        const emuToPixels = width / 9144000; // Approximate conversion
        const x = Math.round(parseInt(transformMatch[1]) * emuToPixels);
        const y = Math.round(parseInt(transformMatch[2]) * emuToPixels);
        const w = Math.round(parseInt(transformMatch[3]) * emuToPixels);
        const h = Math.round(parseInt(transformMatch[4]) * emuToPixels);
        
        // Draw shape
        if (fillColor && w > 0 && h > 0) {
            ctx.fillStyle = fillColor;
            ctx.fillRect(x, y, w, h);
        }
        
    } catch (err) {
        // Silently ignore shape rendering errors
    }
}

/**
 * Render extracted text content on canvas
 */
function renderTextContent(ctx, textContent, width, height) {
    try {
        const padding = 30;
        const maxWidth = width - (padding * 2);
        const lineHeight = 24;
        
        ctx.fillStyle = '#1f2937';
        ctx.font = '16px Poppins, sans-serif';
        ctx.textBaseline = 'top';
        
        // Word wrap text
        const words = textContent.split(/\s+/).filter(w => w.length > 0);
        let line = '';
        let y = 40;
        
        for (const word of words) {
            if (y > height - 50) break;
            
            const testLine = line + (line ? ' ' : '') + word;
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && line) {
                ctx.fillText(line, padding, y);
                y += lineHeight;
                line = word;
            } else {
                line = testLine;
            }
        }
        
        if (line && y <= height - 50) {
            ctx.fillText(line, padding, y);
        }
        
    } catch (err) {
        console.warn('[PPTX Renderer] Error rendering text:', err.message);
    }
}

/**
 * Extract text from slide XML
 */
function extractSlideText(slideXml, zip, slideFile) {
    try {
        // Extract all text from <a:t> tags
        const textMatches = slideXml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
        
        const textSegments = textMatches
            .map(match => match.replace(/<a:t>|<\/a:t>/g, ''))
            .filter(text => {
                const trimmed = text.trim().toLowerCase();
                
                // Filter out placeholder text patterns
                const dummyPatterns = [
                    'click to add',
                    'dummy',
                    'smart',
                    'placeholder',
                    'text',
                    'shape'
                ];
                
                // Only exclude if it's EXACTLY one of the dummy patterns
                if (dummyPatterns.includes(trimmed)) {
                    return false;
                }
                
                // Keep meaningful content
                return text.trim().length > 1 && text.length < 1000;
            });
        
        if (textSegments.length > 0) {
            let fullText = textSegments.join(' ');
            fullText = fullText.replace(/\s+/g, ' ').trim();
            
            console.log(`[PPTX Renderer] Extracted text from slide: "${fullText.substring(0, 100)}"`);
            return fullText;
        }
        
        return '';
        
    } catch (err) {
        console.warn('[PPTX Renderer] Error extracting text:', err.message);
        return '';
    }
}

module.exports = {
    convertPptxToImages
};
