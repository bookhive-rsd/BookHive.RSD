/**
 * PPTX to Images Converter
 * Converts PowerPoint presentations to image representations of slides
 * Handles SmartArt, complex shapes, and various Office elements
 */

async function convertPptxToImages(arrayBuffer) {
    try {
        console.log('Converting PPTX, buffer size:', arrayBuffer.byteLength);
        
        const zip = await JSZip.loadAsync(arrayBuffer);
        console.log('Successfully loaded ZIP');
        
        const slides = [];
        
        // Get slide files
        const slideFiles = Object.keys(zip.files)
            .filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
            .sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)[0]);
                const numB = parseInt(b.match(/\d+/)[0]);
                return numA - numB;
            });
        
        console.log('Found slide files:', slideFiles.length);
        
        if (slideFiles.length === 0) {
            throw new Error('No slides found in PPTX file');
        }
        
        // Get presentation dimensions from presentation.xml using regex
        let slideWidth = 960;
        let slideHeight = 720;
        
        try {
            const presXml = await zip.file('ppt/presentation.xml').async('text');
            const sldSzMatch = presXml.match(/<p:sldSz\s+[^>]*cx="(\d+)"[^>]*cy="(\d+)"[^>]*>/);
            if (sldSzMatch) {
                // Convert EMU (English Metric Units) to pixels
                // 914400 EMU = 1 inch, at 96 DPI = 96 pixels
                const emuToPixels = 96 / 914400;
                slideWidth = Math.round(parseInt(sldSzMatch[1]) * emuToPixels);
                slideHeight = Math.round(parseInt(sldSzMatch[2]) * emuToPixels);
                console.log('Slide dimensions from EMU:', sldSzMatch[1], 'x', sldSzMatch[2], '-> pixels:', slideWidth, 'x', slideHeight);
            }
        } catch (e) {
            console.warn('Could not determine slide dimensions, using defaults');
        }
        
        console.log('Slide dimensions:', slideWidth, 'x', slideHeight);
        
        // Process each slide
        for (let i = 0; i < slideFiles.length; i++) {
            const slideFile = slideFiles[i];
            const slideNum = i + 1;
            
            try {
                const slideXml = await zip.file(slideFile).async('text');
                
                // Extract text content
                let textContent = extractSlideText(slideXml);
                
                // Create a canvas representation with reasonable minimum size
                const canvas = document.createElement('canvas');
                // Ensure canvas is at least 800x600, with aspect ratio preserved
                const minWidth = 800;
                const minHeight = 600;
                
                let canvasWidth = Math.max(slideWidth, minWidth);
                let canvasHeight = Math.max(slideHeight, minHeight);
                
                // Scale canvas if it's too large
                const maxCanvasWidth = 1200;
                if (canvasWidth > maxCanvasWidth) {
                    const scale = maxCanvasWidth / canvasWidth;
                    canvasWidth = Math.round(canvasWidth * scale);
                    canvasHeight = Math.round(canvasHeight * scale);
                }
                
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;
                
                console.log('Canvas size:', canvas.width, 'x', canvas.height);
                
                const ctx = canvas.getContext('2d');
                
                // Draw white background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                // Draw border
                ctx.strokeStyle = '#e5e7eb';
                ctx.lineWidth = 2;
                ctx.strokeRect(0, 0, canvas.width, canvas.height);
                
                // Draw slide number at the bottom
                ctx.fillStyle = '#9ca3af';
                ctx.font = '12px Poppins, sans-serif';
                ctx.fillText(`Slide ${slideNum} of ${slideFiles.length}`, 15, canvas.height - 15);
                
                // Draw text content with proper formatting
                if (textContent && textContent.trim().length > 0) {
                    ctx.fillStyle = '#1f2937';
                    ctx.font = '16px Poppins, sans-serif';
                    ctx.fontWeight = 'bold';
                    
                    // Word wrap text with better spacing
                    const words = textContent.split(/\s+/).filter(w => w.length > 0);
                    let line = '';
                    let y = 60;
                    const maxWidth = canvas.width - 40;
                    const lineHeight = 28;
                    
                    for (let j = 0; j < words.length && y < canvas.height - 50; j++) {
                        const testLine = line + (line ? ' ' : '') + words[j];
                        const metrics = ctx.measureText(testLine);
                        
                        if (metrics.width > maxWidth && line) {
                            // Draw current line and move to next
                            ctx.fillText(line, 20, y);
                            y += lineHeight;
                            line = words[j];
                        } else {
                            line = testLine;
                        }
                    }
                    
                    // Draw final line if there's any text left
                    if (line && y < canvas.height - 50) {
                        ctx.fillText(line, 20, y);
                    }
                } else {
                    // Show message if no text content found
                    ctx.fillStyle = '#d1d5db';
                    ctx.font = '18px Poppins, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('Slide ' + slideNum, canvas.width / 2, canvas.height / 2);
                    ctx.font = '14px Poppins, sans-serif';
                    ctx.fillStyle = '#9ca3af';
                    ctx.fillText('(Slide contains visual content or is empty)', canvas.width / 2, canvas.height / 2 + 40);
                    ctx.textAlign = 'left';
                }
                
                slides.push({
                    slideNum: slideNum,
                    image: canvas.toDataURL('image/png'),
                    textContent: textContent
                });
                
            } catch (err) {
                console.warn(`Could not process slide ${slideNum}:`, err.message);
                
                // Create error slide with proper sizing
                const canvas = document.createElement('canvas');
                canvas.width = 800;
                canvas.height = 600;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#fff3cd';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.strokeStyle = '#ffc107';
                ctx.lineWidth = 2;
                ctx.strokeRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#856404';
                ctx.font = 'bold 16px Poppins, sans-serif';
                ctx.fillText(`Slide ${slideNum} - Unable to load`, 15, 50);
                ctx.font = '12px Poppins, sans-serif';
                ctx.fillText(err.message, 15, 80);
                
                slides.push({
                    slideNum: slideNum,
                    image: canvas.toDataURL('image/png'),
                    textContent: ''
                });
            }
        }
        
        console.log('Successfully converted all slides:', slides.length);
        return slides;
        
    } catch (err) {
        console.error('Error converting PPTX:', err);
        throw err;
    }
}

/**
 * Clean PPTX XML to handle SmartArt and complex elements
 */
function cleanPptxXml(xmlString) {
    try {
        // Remove namespace declarations to make parsing easier
        let cleaned = xmlString.replace(/xmlns[^=]*="[^"]*"/g, '');
        
        // Handle SmartArt elements - just extract text if available
        // SmartArt is in <p:graphicFrame> with <a:graphic> containing data models
        cleaned = cleaned.replace(/<p:graphicFrame[^>]*>[\s\S]*?<\/p:graphicFrame>/g, '');
        
        // Keep only essential text-bearing elements
        return cleaned;
    } catch (e) {
        console.warn('Error cleaning XML:', e);
        return xmlString;
    }
}

/**
 * Extract text from slide with multiple fallback methods
 * Works with raw XML string directly
 */
function extractSlideText(rawXml) {
    try {
        // Method 1: Extract all text from <a:t> tags using regex
        const textMatches = rawXml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
        
        if (textMatches.length > 0) {
            // Extract text content and filter out common placeholder/dummy text
            const textSegments = textMatches
                .map(match => match.replace(/<a:t>|<\/a:t>/g, ''))
                .filter(text => {
                    // Remove placeholder and dummy text patterns
                    const trimmed = text.trim().toLowerCase();
                    
                    // Filter out common SmartArt and Office dummy text
                    const dummyPatterns = [
                        'click to add text',
                        'dummy',
                        'smart',
                        'placeholder',
                        'title',
                        'content',
                        'bullet point',
                        'text here',
                        'your text here',
                        'shape1',
                        'shape2',
                        'connectorformat'
                    ];
                    
                    // Check if text matches any dummy pattern
                    if (dummyPatterns.some(pattern => trimmed === pattern || trimmed.startsWith(pattern + ' '))) {
                        return false;
                    }
                    
                    // Keep only non-empty text that isn't just whitespace
                    return text.trim().length > 0 && text.length < 500; // Reasonable text limit
                });
            
            if (textSegments.length > 0) {
                // Join segments with space and clean up multiple spaces
                let fullText = textSegments.join(' ');
                fullText = fullText.replace(/\s+/g, ' ').trim();
                
                console.log('Extracted text segments:', textSegments.length);
                console.log('Extracted text:', fullText.substring(0, 200)); // Log first 200 chars
                return fullText;
            }
        }
        
        // Method 2: Try to extract from alternative text locations
        const altTextMatches = rawXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
        if (altTextMatches.length > 0) {
            const altText = altTextMatches
                .map(match => match.replace(/<[^>]+>/g, ''))
                .filter(t => t.trim().length > 0)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            if (altText && altText.length > 0) {
                console.log('Extracted from alternative location:', altText.substring(0, 200));
                return altText;
            }
        }
        
    } catch (e) {
        console.warn('Text extraction failed:', e);
    }
    
    console.log('No text content found in slide');
    return '';
}
