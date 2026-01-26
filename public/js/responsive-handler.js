/**
 * Responsive UI Handler
 * Manages dynamic responsive behavior, zoom levels, and device adjustments
 */

class ResponsiveUIHandler {
  constructor() {
    this.currentZoom = 100;
    this.currentWidth = window.innerWidth;
    this.currentHeight = window.innerHeight;
    this.breakpoints = {
      ultraLarge: 2560,
      extraLarge: 1920,
      large: 1024,
      tablet: 768,
      tabletSmall: 600,
      phone: 480,
      phoneSmall: 360,
      extra: 0
    };
    
    this.init();
  }

  /**
   * Initialize responsive handler
   */
  init() {
    this.setupViewportMeta();
    this.detectZoom();
    this.setupEventListeners();
    this.handleInitialLayout();
    this.startResizeObserver();
  }

  /**
   * Setup or update viewport meta tag for proper scaling
   */
  setupViewportMeta() {
    let viewport = document.querySelector('meta[name="viewport"]');
    
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.name = 'viewport';
      document.head.appendChild(viewport);
    }
    
    viewport.setAttribute('content', 
      'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover'
    );
  }

  /**
   * Detect current zoom level
   */
  detectZoom() {
    // Method 1: Using window.devicePixelRatio
    const dpr = window.devicePixelRatio || 1;
    
    // Method 2: Using CSS pixel ratio
    const zoom = Math.round(
      (window.outerWidth / window.innerWidth) * 100
    ) || 100;
    
    this.currentZoom = zoom;
    
    // Apply zoom-related classes to body
    document.body.classList.remove('zoom-75', 'zoom-90', 'zoom-100', 'zoom-110', 'zoom-125', 'zoom-150');
    
    if (zoom <= 75) document.body.classList.add('zoom-75');
    else if (zoom <= 90) document.body.classList.add('zoom-90');
    else if (zoom <= 110) document.body.classList.add('zoom-100');
    else if (zoom <= 125) document.body.classList.add('zoom-110');
    else if (zoom <= 150) document.body.classList.add('zoom-125');
    else document.body.classList.add('zoom-150');

    return zoom;
  }

  /**
   * Get current device type based on viewport width
   */
  getDeviceType() {
    const width = this.currentWidth;
    
    if (width >= this.breakpoints.ultraLarge) return 'ultra-large-desktop';
    if (width >= this.breakpoints.extraLarge) return 'large-desktop';
    if (width >= this.breakpoints.large) return 'desktop';
    if (width >= this.breakpoints.tablet) return 'tablet';
    if (width >= this.breakpoints.tabletSmall) return 'tablet-portrait';
    if (width >= this.breakpoints.phone) return 'phone-large';
    if (width >= this.breakpoints.phoneSmall) return 'phone';
    return 'phone-extra-small';
  }

  /**
   * Apply zoom adjustment styles dynamically
   */
  applyZoomStyles() {
    const zoom = this.currentZoom;
    const root = document.documentElement;
    
    // Adjust root font size based on zoom
    if (zoom <= 75) {
      root.style.fontSize = '13px';
    } else if (zoom <= 90) {
      root.style.fontSize = '14px';
    } else if (zoom <= 110) {
      root.style.fontSize = '16px';
    } else if (zoom <= 125) {
      root.style.fontSize = '18px';
    } else if (zoom <= 150) {
      root.style.fontSize = '19px';
    } else {
      root.style.fontSize = '20px';
    }

    // Adjust spacing and padding for zoom
    this.adjustElementsForZoom(zoom);
  }

  /**
   * Adjust individual elements for zoom level
   */
  adjustElementsForZoom(zoom) {
    const elements = document.querySelectorAll('[data-responsive]');
    
    elements.forEach(el => {
      const baseSize = parseInt(el.dataset.baseSize) || 16;
      const newSize = Math.round((baseSize * zoom) / 100);
      el.style.fontSize = newSize + 'px';
    });
  }

  /**
   * Handle initial layout adjustment
   */
  handleInitialLayout() {
    this.updateDimensions();
    this.applyZoomStyles();
    this.optimizeNavigation();
    this.optimizeGrids();
    this.optimizeModals();
    this.applyDimensionClasses();
  }

  /**
   * Update current width and height
   */
  updateDimensions() {
    this.currentWidth = window.innerWidth;
    this.currentHeight = window.innerHeight;
    
    // Update CSS custom properties for viewport dimensions
    document.documentElement.style.setProperty('--viewport-width', `${this.currentWidth}px`);
    document.documentElement.style.setProperty('--viewport-height', `${this.currentHeight}px`);
    
    // Add dimension classes for targeted styling
    this.applyDimensionClasses();
  }

  /**
   * Apply dimension-based CSS classes
   */
  applyDimensionClasses() {
    const width = this.currentWidth;
    const height = this.currentHeight;
    const root = document.documentElement;

    // Remove old dimension classes
    root.classList.remove(
      'viewport-ultra-wide', 'viewport-wide', 'viewport-normal',
      'viewport-tall', 'viewport-short', 'viewport-ultra-short'
    );

    // Add width-based classes
    if (width >= 2560) root.classList.add('viewport-ultra-wide');
    else if (width >= 1920) root.classList.add('viewport-wide');
    else root.classList.add('viewport-normal');

    // Add height-based classes
    if (height >= 1000) root.classList.add('viewport-tall');
    else if (height >= 600) root.classList.add('viewport-normal');
    else if (height >= 400) root.classList.add('viewport-short');
    else root.classList.add('viewport-ultra-short');
  }

  /**
   * Optimize navigation for device
   */
  optimizeNavigation() {
    const navMenu = document.querySelector('.nav-menu');
    const header = document.querySelector('header');
    
    if (!navMenu || !header) return;

    const device = this.getDeviceType();
    
    if (device.includes('phone')) {
      navMenu.classList.add('mobile-optimized');
      
      // Create hamburger menu if not exists
      if (!document.querySelector('.hamburger-menu')) {
        this.createMobileNav();
      }
    } else {
      navMenu.classList.remove('mobile-optimized');
      this.removeMobileNav();
    }
  }

  /**
   * Create mobile navigation menu
   */
  createMobileNav() {
    const header = document.querySelector('header .container');
    if (!header || document.querySelector('.hamburger-menu')) return;

    const hamburger = document.createElement('button');
    hamburger.className = 'hamburger-menu';
    hamburger.innerHTML = `
      <span></span>
      <span></span>
      <span></span>
    `;
    hamburger.setAttribute('aria-label', 'Toggle navigation');
    
    header.appendChild(hamburger);

    hamburger.addEventListener('click', () => {
      const navMenu = document.querySelector('.nav-menu');
      navMenu.classList.toggle('mobile-active');
      hamburger.classList.toggle('active');
    });

    // Close menu when clicking on links
    const navLinks = document.querySelectorAll('.nav-menu a');
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        const navMenu = document.querySelector('.nav-menu');
        navMenu.classList.remove('mobile-active');
        hamburger.classList.remove('active');
      });
    });
  }

  /**
   * Remove mobile navigation
   */
  removeMobileNav() {
    const hamburger = document.querySelector('.hamburger-menu');
    if (hamburger) hamburger.remove();
    
    const navMenu = document.querySelector('.nav-menu');
    if (navMenu) {
      navMenu.classList.remove('mobile-active');
    }
  }

  /**
   * Optimize grid layouts for device
   */
  optimizeGrids() {
    const bookGrids = document.querySelectorAll('.book-grid');
    const featureGrids = document.querySelectorAll('.features');
    const device = this.getDeviceType();
    
    bookGrids.forEach(grid => {
      if (device.includes('phone')) {
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(110px, 1fr))';
        grid.style.gap = '0.6rem';
      } else if (device.includes('tablet')) {
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(150px, 1fr))';
        grid.style.gap = '1rem';
      }
    });

    featureGrids.forEach(grid => {
      if (device.includes('phone')) {
        grid.style.gridTemplateColumns = '1fr';
      } else if (device.includes('tablet')) {
        grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
      }
    });
  }

  /**
   * Optimize modals for device
   */
  optimizeModals() {
    const modals = document.querySelectorAll('.modal-content');
    const device = this.getDeviceType();
    
    modals.forEach(modal => {
      if (device.includes('phone')) {
        modal.style.width = '95%';
        modal.style.maxWidth = 'none';
        modal.style.margin = '20% auto';
      } else if (device.includes('tablet')) {
        modal.style.width = '90%';
        modal.style.maxWidth = '600px';
      }
    });
  }

  /**
   * Setup event listeners for responsive behavior
   */
  setupEventListeners() {
    // Debounced resize handler
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.handleResize();
      }, 250);
    });

    // Orientation change
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        this.handleOrientationChange();
      }, 100);
    });

    // Zoom change detection (using visibility API)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.detectZoom();
        this.applyZoomStyles();
      }
    });

    // Detect zoom on focus
    window.addEventListener('focus', () => {
      this.detectZoom();
      this.applyZoomStyles();
    });
  }

  /**
   * Handle window resize
   */
  handleResize() {
    const oldWidth = this.currentWidth;
    this.updateDimensions();
    
    if (oldWidth !== this.currentWidth) {
      this.detectZoom();
      this.applyZoomStyles();
      this.handleInitialLayout();
      
      // Dispatch custom event
      window.dispatchEvent(new CustomEvent('responsiveBreakpointChange', {
        detail: {
          device: this.getDeviceType(),
          width: this.currentWidth,
          height: this.currentHeight,
          zoom: this.currentZoom
        }
      }));
    }
  }

  /**
   * Handle orientation change
   */
  handleOrientationChange() {
    this.updateDimensions();
    this.handleInitialLayout();
  }

  /**
   * Start observing DOM changes
   */
  startResizeObserver() {
    if (!window.ResizeObserver) return;

    const observer = new ResizeObserver(() => {
      this.optimizeGrids();
      this.optimizeModals();
    });

    // Observe main container and content areas
    const containers = document.querySelectorAll('main, .container, [data-responsive-container]');
    containers.forEach(container => {
      observer.observe(container);
    });
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      device: this.getDeviceType(),
      width: this.currentWidth,
      height: this.currentHeight,
      zoom: this.currentZoom,
      devicePixelRatio: window.devicePixelRatio,
      orientation: window.orientation || (this.currentWidth > this.currentHeight ? 0 : 90),
      isSmallHeight: this.currentHeight < 600,
      isMobileSize: this.currentWidth < 768,
      screenResolution: `${this.currentWidth}x${this.currentHeight}`
    };
  }

  /**
   * Public method to trigger responsive check
   */
  checkResponsiveness() {
    this.handleResize();
  }
}

// Initialize responsive handler when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.responsiveHandler = new ResponsiveUIHandler();
});

// Also initialize as soon as script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.responsiveHandler = new ResponsiveUIHandler();
  });
} else {
  window.responsiveHandler = new ResponsiveUIHandler();
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ResponsiveUIHandler;
}
