// Email template configurations with modern styling and animations

const emailTemplates = {
  // Login alert email with modern design
  loginAlert: (username, loginTime, userAgent, ipAddress) => {
    return {
      subject: `🔐 New Login to Your BookHive Account - ${new Date(loginTime).toLocaleDateString()}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              padding: 20px;
              min-height: 100vh;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: white;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
              overflow: hidden;
              animation: slideIn 0.6s ease-out;
            }
            @keyframes slideIn {
              from {
                opacity: 0;
                transform: translateY(20px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 40px 20px;
              text-align: center;
              position: relative;
              overflow: hidden;
            }
            .header::before {
              content: '';
              position: absolute;
              top: -50%;
              right: -50%;
              width: 300px;
              height: 300px;
              background: rgba(255, 255, 255, 0.1);
              border-radius: 50%;
              animation: float 6s ease-in-out infinite;
            }
            @keyframes float {
              0%, 100% { transform: translateY(0px); }
              50% { transform: translateY(20px); }
            }
            .header h1 {
              font-size: 28px;
              margin-bottom: 10px;
              position: relative;
              z-index: 1;
            }
            .header p {
              font-size: 16px;
              opacity: 0.9;
              position: relative;
              z-index: 1;
            }
            .content {
              padding: 40px 30px;
            }
            .alert-box {
              background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
              border-left: 4px solid #667eea;
              padding: 20px;
              border-radius: 8px;
              margin-bottom: 30px;
              animation: fadeIn 0.8s ease-out 0.3s both;
            }
            @keyframes fadeIn {
              from {
                opacity: 0;
              }
              to {
                opacity: 1;
              }
            }
            .alert-box h2 {
              color: #667eea;
              margin-bottom: 15px;
              font-size: 18px;
            }
            .detail-item {
              display: flex;
              justify-content: space-between;
              padding: 10px 0;
              border-bottom: 1px solid rgba(102, 126, 234, 0.1);
              font-size: 14px;
            }
            .detail-item:last-child {
              border-bottom: none;
            }
            .detail-label {
              color: #666;
              font-weight: 600;
            }
            .detail-value {
              color: #333;
            }
            .security-section {
              background: #fff3cd;
              border: 1px solid #ffc107;
              border-radius: 8px;
              padding: 20px;
              margin: 30px 0;
              animation: slideUp 0.8s ease-out 0.5s both;
            }
            @keyframes slideUp {
              from {
                opacity: 0;
                transform: translateY(20px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            .security-section h3 {
              color: #856404;
              margin-bottom: 10px;
              font-size: 16px;
            }
            .security-section p {
              color: #856404;
              font-size: 14px;
              line-height: 1.6;
            }
            .cta-button {
              display: inline-block;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 12px 30px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: 600;
              margin: 20px 0;
              transition: all 0.3s ease;
              box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
              animation: pulse 2s infinite 1s;
            }
            @keyframes pulse {
              0%, 100% {
                box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
              }
              50% {
                box-shadow: 0 4px 25px rgba(102, 126, 234, 0.8);
              }
            }
            .cta-button:hover {
              transform: translateY(-2px);
              box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
            }
            .footer {
              background: #f8f9fa;
              border-top: 1px solid #e9ecef;
              padding: 20px;
              text-align: center;
              font-size: 13px;
              color: #666;
            }
            .footer a {
              color: #667eea;
              text-decoration: none;
            }
            .divider {
              height: 1px;
              background: linear-gradient(90deg, transparent, #667eea, transparent);
              margin: 30px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Login Detected</h1>
              <p>We noticed a new login to your BookHive account</p>
            </div>
            
            <div class="content">
              <p>Hi <strong>${username}</strong>,</p>
              
              <div class="alert-box">
                <h2>✓ Login Confirmed</h2>
                <div class="detail-item">
                  <span class="detail-label">Time:</span>
                  <span class="detail-value">${new Date(loginTime).toLocaleString()}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Device:</span>
                  <span class="detail-value">${userAgent || 'Unknown'}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">IP Address:</span>
                  <span class="detail-value">${ipAddress || 'Not available'}</span>
                </div>
              </div>
              
              <div class="security-section">
                <h3>🛡️ Security Notice</h3>
                <p>If this wasn't you, please <a href="#" style="color: #856404; font-weight: bold;">change your password immediately</a> and contact our support team.</p>
              </div>
              
              <div class="divider"></div>
              
              <p style="margin: 20px 0; line-height: 1.6; color: #333;">
                You can manage your notification preferences and security settings anytime in your account dashboard.
              </p>
              
              <a href="[BASE_URL]/account" class="cta-button">View Account Settings</a>
            </div>
            
            <div class="footer">
              <p>© 2024 BookHive. All rights reserved.</p>
              <p>
                <a href="[BASE_URL]/account">Manage Notifications</a> | 
                <a href="[BASE_URL]">Visit BookHive</a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    };
  },

  // News update email
  newsUpdate: (username, newsTitle, newsContent, newsLink) => {
    return {
      subject: `📰 New News Update - ${newsTitle}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
              padding: 20px;
              min-height: 100vh;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: white;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
              overflow: hidden;
              animation: slideIn 0.6s ease-out;
            }
            @keyframes slideIn {
              from {
                opacity: 0;
                transform: translateY(20px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            .header {
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
              color: white;
              padding: 40px 20px;
              text-align: center;
            }
            .header h1 {
              font-size: 28px;
              margin-bottom: 10px;
            }
            .content {
              padding: 40px 30px;
            }
            .news-box {
              background: linear-gradient(135deg, #f093fb15 0%, #f5576c15 100%);
              border-left: 4px solid #f5576c;
              padding: 25px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .news-box h2 {
              color: #f5576c;
              margin-bottom: 15px;
              font-size: 20px;
            }
            .news-box p {
              color: #333;
              line-height: 1.6;
              margin-bottom: 15px;
              font-size: 14px;
            }
            .cta-button {
              display: inline-block;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
              color: white;
              padding: 12px 30px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: 600;
              transition: all 0.3s ease;
              box-shadow: 0 4px 15px rgba(245, 87, 108, 0.4);
              animation: pulse 2s infinite 0.5s;
            }
            @keyframes pulse {
              0%, 100% {
                box-shadow: 0 4px 15px rgba(245, 87, 108, 0.4);
              }
              50% {
                box-shadow: 0 4px 25px rgba(245, 87, 108, 0.8);
              }
            }
            .cta-button:hover {
              transform: translateY(-2px);
            }
            .footer {
              background: #f8f9fa;
              border-top: 1px solid #e9ecef;
              padding: 20px;
              text-align: center;
              font-size: 13px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📰 News Update</h1>
            </div>
            
            <div class="content">
              <p>Hi <strong>${username}</strong>,</p>
              <p>Great news! There's new content you might be interested in:</p>
              
              <div class="news-box">
                <h2>${newsTitle}</h2>
                <p>${newsContent}</p>
                <a href="${newsLink}" class="cta-button">Read Full Story</a>
              </div>
              
              <p style="margin-top: 20px; color: #666; font-size: 14px;">
                Stay updated with the latest news on BookHive. You can manage your notification preferences anytime.
              </p>
            </div>
            
            <div class="footer">
              <p>© 2024 BookHive. All rights reserved.</p>
              <p><a href="[BASE_URL]/account">Manage Notifications</a></p>
            </div>
          </div>
        </body>
        </html>
      `
    };
  },

  // Publication update email
  publicationUpdate: (username, publicationAuthor, publicationPreview, publicationLink) => {
    return {
      subject: `📚 New Publication by ${publicationAuthor}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
              padding: 20px;
              min-height: 100vh;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: white;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
              overflow: hidden;
              animation: slideIn 0.6s ease-out;
            }
            @keyframes slideIn {
              from {
                opacity: 0;
                transform: translateY(20px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            .header {
              background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
              color: white;
              padding: 40px 20px;
              text-align: center;
            }
            .header h1 {
              font-size: 28px;
              margin-bottom: 10px;
            }
            .content {
              padding: 40px 30px;
            }
            .publication-box {
              background: linear-gradient(135deg, #4facfe15 0%, #00f2fe15 100%);
              border-left: 4px solid #00f2fe;
              padding: 25px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .publication-box h2 {
              color: #00f2fe;
              margin-bottom: 15px;
              font-size: 20px;
            }
            .publication-box .author {
              color: #4facfe;
              font-weight: 600;
              margin-bottom: 15px;
              font-size: 14px;
            }
            .publication-box p {
              color: #333;
              line-height: 1.6;
              margin-bottom: 15px;
              font-size: 14px;
            }
            .cta-button {
              display: inline-block;
              background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
              color: white;
              padding: 12px 30px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: 600;
              transition: all 0.3s ease;
              box-shadow: 0 4px 15px rgba(79, 172, 254, 0.4);
              animation: pulse 2s infinite 0.5s;
            }
            @keyframes pulse {
              0%, 100% {
                box-shadow: 0 4px 15px rgba(79, 172, 254, 0.4);
              }
              50% {
                box-shadow: 0 4px 25px rgba(79, 172, 254, 0.8);
              }
            }
            .cta-button:hover {
              transform: translateY(-2px);
            }
            .footer {
              background: #f8f9fa;
              border-top: 1px solid #e9ecef;
              padding: 20px;
              text-align: center;
              font-size: 13px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📚 New Publication</h1>
            </div>
            
            <div class="content">
              <p>Hi <strong>${username}</strong>,</p>
              <p>A new publication has been shared on BookHive:</p>
              
              <div class="publication-box">
                <p class="author">By <strong>${publicationAuthor}</strong></p>
                <p>${publicationPreview}</p>
                <a href="${publicationLink}" class="cta-button">View Publication</a>
              </div>
              
              <p style="margin-top: 20px; color: #666; font-size: 14px;">
                Discover and engage with the latest publications in our community.
              </p>
            </div>
            
            <div class="footer">
              <p>© 2024 BookHive. All rights reserved.</p>
              <p><a href="[BASE_URL]/account">Manage Notifications</a></p>
            </div>
          </div>
        </body>
        </html>
      `
    };
  },

  // General notification email
  communityNotification: (username, notificationTitle, notificationMessage, actionLink) => {
    return {
      subject: `💬 ${notificationTitle}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
              padding: 20px;
              min-height: 100vh;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: white;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
              overflow: hidden;
              animation: slideIn 0.6s ease-out;
            }
            @keyframes slideIn {
              from {
                opacity: 0;
                transform: translateY(20px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            .header {
              background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
              color: white;
              padding: 40px 20px;
              text-align: center;
            }
            .header h1 {
              font-size: 28px;
              margin-bottom: 10px;
            }
            .content {
              padding: 40px 30px;
            }
            .notification-box {
              background: linear-gradient(135deg, #fa709a15 0%, #fee14015 100%);
              border-left: 4px solid #fa709a;
              padding: 25px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .notification-box h2 {
              color: #fa709a;
              margin-bottom: 15px;
              font-size: 20px;
            }
            .notification-box p {
              color: #333;
              line-height: 1.6;
              margin-bottom: 15px;
              font-size: 14px;
            }
            .cta-button {
              display: inline-block;
              background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
              color: white;
              padding: 12px 30px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: 600;
              transition: all 0.3s ease;
              box-shadow: 0 4px 15px rgba(250, 112, 154, 0.4);
              animation: pulse 2s infinite 0.5s;
            }
            @keyframes pulse {
              0%, 100% {
                box-shadow: 0 4px 15px rgba(250, 112, 154, 0.4);
              }
              50% {
                box-shadow: 0 4px 25px rgba(250, 112, 154, 0.8);
              }
            }
            .cta-button:hover {
              transform: translateY(-2px);
            }
            .footer {
              background: #f8f9fa;
              border-top: 1px solid #e9ecef;
              padding: 20px;
              text-align: center;
              font-size: 13px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>💬 ${notificationTitle}</h1>
            </div>
            
            <div class="content">
              <p>Hi <strong>${username}</strong>,</p>
              
              <div class="notification-box">
                <p>${notificationMessage}</p>
                ${actionLink ? `<a href="${actionLink}" class="cta-button">View Details</a>` : ''}
              </div>
              
              <p style="margin-top: 20px; color: #666; font-size: 14px;">
                Stay connected with our community and never miss important updates.
              </p>
            </div>
            
            <div class="footer">
              <p>© 2024 BookHive. All rights reserved.</p>
              <p><a href="[BASE_URL]/account">Manage Notifications</a></p>
            </div>
          </div>
        </body>
        </html>
      `
    };
  },

  // Book update email template - IMPORTANT
  bookUpdate: (username, bookTitle, authorName, updateSummary, bookLink) => {
    return {
      subject: `📖 "${bookTitle}" Has Been Updated!`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              padding: 20px;
              min-height: 100vh;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: white;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
              overflow: hidden;
              animation: slideIn 0.6s ease-out;
            }
            @keyframes slideIn {
              from {
                opacity: 0;
                transform: translateY(20px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 40px 20px;
              text-align: center;
              position: relative;
              overflow: hidden;
            }
            .header::before {
              content: '';
              position: absolute;
              top: -50%;
              left: -50%;
              width: 300px;
              height: 300px;
              background: rgba(255, 255, 255, 0.1);
              border-radius: 50%;
              animation: float 8s ease-in-out infinite;
            }
            @keyframes float {
              0%, 100% { transform: translateY(0px) rotate(0deg); }
              50% { transform: translateY(20px) rotate(180deg); }
            }
            .header h1 {
              font-size: 28px;
              margin-bottom: 10px;
              position: relative;
              z-index: 1;
            }
            .header p {
              font-size: 16px;
              opacity: 0.9;
              position: relative;
              z-index: 1;
            }
            .content {
              padding: 40px 30px;
            }
            .book-update-box {
              background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
              border: 2px solid #667eea;
              border-radius: 12px;
              padding: 30px;
              margin: 25px 0;
              position: relative;
              animation: slideUp 0.8s ease-out 0.3s both;
            }
            @keyframes slideUp {
              from {
                opacity: 0;
                transform: translateY(20px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            .book-icon {
              font-size: 48px;
              text-align: center;
              margin-bottom: 15px;
              animation: bounce 2s infinite;
            }
            @keyframes bounce {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-10px); }
            }
            .book-title {
              font-size: 22px;
              font-weight: 700;
              color: #667eea;
              margin: 15px 0;
              text-align: center;
            }
            .book-author {
              font-size: 16px;
              color: #764ba2;
              text-align: center;
              margin-bottom: 20px;
            }
            .update-summary {
              background: white;
              border-left: 4px solid #667eea;
              padding: 15px;
              border-radius: 6px;
              color: #333;
              line-height: 1.6;
              font-size: 14px;
              margin: 15px 0;
            }
            .update-badge {
              display: inline-block;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 8px 12px;
              border-radius: 20px;
              font-size: 12px;
              font-weight: 600;
              margin: 10px 0;
            }
            .cta-button {
              display: block;
              text-align: center;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 14px 40px;
              border-radius: 8px;
              text-decoration: none;
              font-weight: 700;
              font-size: 16px;
              margin: 25px 0;
              transition: all 0.3s ease;
              box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
              animation: pulse 2s infinite 0.8s;
            }
            @keyframes pulse {
              0%, 100% {
                box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
              }
              50% {
                box-shadow: 0 6px 30px rgba(102, 126, 234, 0.8);
              }
            }
            .cta-button:hover {
              transform: translateY(-3px);
              box-shadow: 0 8px 30px rgba(102, 126, 234, 0.6);
            }
            .secondary-text {
              color: #666;
              font-size: 14px;
              line-height: 1.6;
              margin: 20px 0;
            }
            .footer {
              background: #f8f9fa;
              border-top: 1px solid #e9ecef;
              padding: 20px;
              text-align: center;
              font-size: 13px;
              color: #666;
            }
            .footer a {
              color: #667eea;
              text-decoration: none;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📖 Book Updated!</h1>
              <p>One of your favorite books has new content</p>
            </div>
            
            <div class="content">
              <p>Hi <strong>${username}</strong>,</p>
              
              <div class="book-update-box">
                <div class="book-icon">📖</div>
                <div class="book-title">${bookTitle}</div>
                <div class="book-author">by ${authorName}</div>
                <div class="update-badge">✨ NEW CONTENT ADDED</div>
                
                <div class="update-summary">
                  <strong>What's New:</strong><br>
                  ${updateSummary}
                </div>
                
                <p style="text-align: center; color: #667eea; font-weight: 600; margin-top: 15px;">
                  Don't miss out! Check the latest updates now.
                </p>
              </div>
              
              <a href="${bookLink}" class="cta-button">📖 Read Updated Book</a>
              
              <p class="secondary-text">
                We noticed you're interested in this book. Here's the latest content that was just added. Go ahead and explore the new sections!
              </p>
            </div>
            
            <div class="footer">
              <p>© 2024 BookHive. All rights reserved.</p>
              <p>
                <a href="[BASE_URL]/account">Manage Notifications</a> | 
                <a href="[BASE_URL]">Visit BookHive</a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    };
  },

  // Welcome email for new users with professional design and animations
  welcomeEmail: (username, baseUrl) => {
    return {
      subject: `🎉 Welcome to BookHive, ${username}! Let\'s Start Your Journey`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              padding: 20px;
              min-height: 100vh;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: white;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
              overflow: hidden;
              animation: slideIn 0.6s ease-out;
            }
            @keyframes slideIn {
              from {
                opacity: 0;
                transform: translateY(20px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            @keyframes fadeIn {
              from {
                opacity: 0;
              }
              to {
                opacity: 1;
              }
            }
            @keyframes pulse {
              0%, 100% {
                transform: scale(1);
              }
              50% {
                transform: scale(1.05);
              }
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 50px 20px;
              text-align: center;
              position: relative;
              overflow: hidden;
            }
            .header::before {
              content: '';
              position: absolute;
              top: -50%;
              right: -50%;
              width: 200%;
              height: 200%;
              background: radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px);
              background-size: 50px 50px;
              animation: moveBackground 15s linear infinite;
            }
            @keyframes moveBackground {
              0% { transform: translate(0, 0); }
              100% { transform: translate(50px, 50px); }
            }
            .header-content {
              position: relative;
              z-index: 1;
              animation: fadeIn 0.8s ease-out;
            }
            .logo-icon {
              font-size: 50px;
              margin-bottom: 15px;
              display: inline-block;
              animation: pulse 2s ease-in-out infinite;
            }
            .header h1 {
              font-size: 32px;
              font-weight: 700;
              margin-bottom: 10px;
              letter-spacing: -0.5px;
            }
            .header p {
              font-size: 16px;
              opacity: 0.95;
              margin: 0;
            }
            .content {
              padding: 40px 30px;
              animation: fadeIn 1s ease-out;
            }
            .welcome-section {
              margin-bottom: 30px;
            }
            .welcome-section h2 {
              color: #667eea;
              font-size: 22px;
              margin-bottom: 15px;
              font-weight: 600;
            }
            .welcome-section p {
              color: #555;
              font-size: 15px;
              line-height: 1.8;
              margin-bottom: 15px;
            }
            .features-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 15px;
              margin: 20px 0;
            }
            .feature-card {
              background: linear-gradient(135deg, #f5f7fa 0%, #e9f0ff 100%);
              padding: 20px;
              border-radius: 8px;
              border-left: 4px solid #667eea;
              transition: all 0.3s ease;
            }
            .feature-card:hover {
              transform: translateY(-5px);
              box-shadow: 0 5px 15px rgba(102, 126, 234, 0.2);
            }
            .feature-icon {
              font-size: 28px;
              margin-bottom: 10px;
              display: block;
            }
            .feature-title {
              color: #667eea;
              font-weight: 600;
              font-size: 14px;
              margin-bottom: 5px;
            }
            .feature-text {
              color: #777;
              font-size: 13px;
              line-height: 1.5;
            }
            .cta-section {
              text-align: center;
              margin: 30px 0;
              padding: 25px;
              background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
              border-radius: 10px;
              border: 1px solid #667eea30;
            }
            .cta-button {
              display: inline-block;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 15px 40px;
              text-decoration: none;
              border-radius: 8px;
              font-weight: 600;
              font-size: 16px;
              transition: all 0.3s ease;
              box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
              border: none;
              cursor: pointer;
            }
            .cta-button:hover {
              transform: translateY(-3px);
              box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
            }
            .security-note {
              background: #fff3cd;
              border-left: 4px solid #ffc107;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
              font-size: 14px;
              color: #856404;
            }
            .security-note strong {
              display: block;
              margin-bottom: 8px;
              color: #ff6b6b;
            }
            .footer {
              background: #f8f9fa;
              padding: 30px;
              text-align: center;
              border-top: 1px solid #e9ecef;
              color: #666;
              font-size: 13px;
              line-height: 1.8;
            }
            .footer a {
              color: #667eea;
              text-decoration: none;
              font-weight: 600;
            }
            .footer a:hover {
              text-decoration: underline;
            }
            .social-links {
              margin: 15px 0;
            }
            .social-links a {
              display: inline-block;
              margin: 0 8px;
              width: 35px;
              height: 35px;
              line-height: 35px;
              border-radius: 50%;
              background: #667eea;
              color: white;
              text-decoration: none;
              font-size: 16px;
              transition: all 0.3s ease;
            }
            .social-links a:hover {
              background: #764ba2;
              transform: translateY(-3px);
            }
            @media (max-width: 600px) {
              .features-grid {
                grid-template-columns: 1fr;
              }
              .header h1 {
                font-size: 24px;
              }
              .content {
                padding: 25px 15px;
              }
              .cta-button {
                width: 100%;
                display: block;
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="header-content">
                <div class="logo-icon">📚</div>
                <h1>Welcome to BookHive!</h1>
                <p>Your Personal Library Awaits</p>
              </div>
            </div>

            <div class="content">
              <div class="welcome-section">
                <h2>Hello ${username}! 👋</h2>
                <p>
                  Thank you for joining BookHive, the ultimate community for book lovers! We're thrilled to have you on board.
                  Whether you're here to discover new reads, share your favorite publications, or connect with fellow bibliophiles,
                  you're in the right place.
                </p>
              </div>

              <div class="cta-section">
                <h3 style="color: #667eea; margin-bottom: 15px; font-size: 18px;">Get Started in 3 Easy Steps</h3>
                <a href="${baseUrl}/bookhive" class="cta-button">📖 Explore Your Library</a>
              </div>

              <div class="welcome-section">
                <h2>What You Can Do Here</h2>
                <div class="features-grid">
                  <div class="feature-card">
                    <span class="feature-icon">📚</span>
                    <div class="feature-title">Build Your Library</div>
                    <div class="feature-text">Upload and organize all your favorite books in one place</div>
                  </div>
                  <div class="feature-card">
                    <span class="feature-icon">✨</span>
                    <div class="feature-title">Share Publications</div>
                    <div class="feature-text">Publish your insights and reviews to inspire others</div>
                  </div>
                  <div class="feature-card">
                    <span class="feature-icon">💬</span>
                    <div class="feature-title">Connect & Discuss</div>
                    <div class="feature-text">Join our community and engage with book discussions</div>
                  </div>
                  <div class="feature-card">
                    <span class="feature-icon">📰</span>
                    <div class="feature-title">Stay Updated</div>
                    <div class="feature-text">Get news and updates about books and authors you love</div>
                  </div>
                </div>
              </div>

              <div class="security-note">
                <strong>🔒 Your Account is Secure</strong>
                We never share your personal information with third parties. Your privacy and security are our top priorities.
                Customize your notification preferences anytime in your <a href="${baseUrl}/notifications" style="color: inherit; font-weight: bold;">Settings</a>.
              </div>

              <div class="welcome-section">
                <h2>Questions? We're Here to Help</h2>
                <p>
                  If you have any questions about BookHive or need assistance getting started, our support team is always
                  ready to help. Feel free to reach out through the feedback form or contact us directly.
                </p>
                <p style="margin-top: 15px;">
                  <strong>Happy reading!</strong><br>
                  The BookHive Team
                </p>
              </div>
            </div>

            <div class="footer">
              <p>
                <a href="${baseUrl}/bookhive">Your Library</a> | 
                <a href="${baseUrl}/publications">Explore Publications</a> | 
                <a href="${baseUrl}/notifications">Notification Settings</a> | 
                <a href="${baseUrl}/account">Account Settings</a>
              </p>
              <div class="social-links">
                <a href="https://twitter.com" title="Twitter">𝕏</a>
                <a href="https://facebook.com" title="Facebook">f</a>
                <a href="https://instagram.com" title="Instagram">📷</a>
              </div>
              <p style="margin-top: 15px; font-size: 12px; opacity: 0.8;">
                © 2024 BookHive. All rights reserved. This is an automated message, please do not reply directly to this email.
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    };
  }
};

module.exports = emailTemplates;
