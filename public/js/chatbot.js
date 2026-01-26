document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('chatbot-toggle-btn');
    const closeBtn = document.getElementById('chatbot-close-btn');
    const sendBtn = document.getElementById('chatbot-send-btn');
    const input = document.getElementById('chatbot-input');
    const container = document.getElementById('chatbot-container');
    const chatBody = document.getElementById('chatbot-body');
    
    // Feedback modal elements
    const feedbackModal = document.getElementById('feedback-modal');
    const feedbackModalClose = document.querySelector('.feedback-modal-close');
    const feedbackButtons = document.querySelectorAll('.feedback-btn');
    const feedbackSubmitBtn = document.getElementById('feedback-submit-btn');
    const feedbackText = document.getElementById('feedback-text');
    
    let selectedFeedback = null;
    let currentResponseData = null;

    // Toggle chatbot visibility when the floating icon is clicked
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            container.classList.toggle('active');
            if (container.classList.contains('active')) {
                input.focus();
            }
        });
    }

    // Close chatbot when the close button in the header is clicked
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            container.classList.remove('active');
        });
    }
    
    // Close feedback modal
    if (feedbackModalClose) {
        feedbackModalClose.addEventListener('click', () => {
            feedbackModal.style.display = 'none';
            selectedFeedback = null;
            feedbackText.value = '';
        });
    }
    
    // Close modal when clicking outside
    if (feedbackModal) {
        window.addEventListener('click', (e) => {
            if (e.target === feedbackModal) {
                feedbackModal.style.display = 'none';
                selectedFeedback = null;
                feedbackText.value = '';
            }
        });
    }
    
    // Handle feedback button selection
    feedbackButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            feedbackButtons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedFeedback = btn.dataset.feedback;
        });
    });
    
    // Handle feedback submission
    if (feedbackSubmitBtn) {
        feedbackSubmitBtn.addEventListener('click', async () => {
            if (!selectedFeedback) {
                alert('Please select a feedback option');
                return;
            }
            
            const comments = feedbackText.value.trim();
            
            try {
                const response = await fetch('/api/chatbot/feedback', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: currentResponseData?.query || '',
                        response: currentResponseData?.response || '',
                        userFeedback: selectedFeedback,
                        userComments: comments
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    alert('Thank you for your feedback! 🙏');
                    feedbackModal.style.display = 'none';
                    selectedFeedback = null;
                    feedbackText.value = '';
                } else {
                    alert('Failed to submit feedback. Please try again.');
                }
            } catch (error) {
                console.error('Feedback submission error:', error);
                alert('Error submitting feedback. Please try again.');
            }
        });
    }
    
    // Function to add a new message to the chat window
    const addMessage = (text, sender, responseData = null) => {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('chat-message', sender);
        
        // Convert simple markdown (bold, italics, newlines) to HTML
        const formattedText = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .replace(/\*(.*?)\*/g, '<em>$1</em>')         // Italic
            .replace(/\n/g, '<br>');                      // Newlines

        const p = document.createElement('p');
        p.innerHTML = formattedText;
        messageDiv.appendChild(p);
        
        // Add feedback button for bot messages that have feedback prompts
        if (sender === 'bot' && text.includes('Was this helpful')) {
            const feedbackButtonDiv = document.createElement('div');
            feedbackButtonDiv.className = 'message-feedback-btn-container';
            
            const feedbackBtn = document.createElement('button');
            feedbackBtn.className = 'message-feedback-btn';
            feedbackBtn.innerHTML = '<i class="fas fa-comment"></i> Share Feedback';
            feedbackBtn.addEventListener('click', () => {
                currentResponseData = responseData;
                feedbackModal.style.display = 'block';
                selectedFeedback = null;
                feedbackButtons.forEach(b => b.classList.remove('selected'));
                feedbackText.value = '';
            });
            
            feedbackButtonDiv.appendChild(feedbackBtn);
            messageDiv.appendChild(feedbackButtonDiv);
        }

        chatBody.appendChild(messageDiv);
        chatBody.scrollTop = chatBody.scrollHeight; // Auto-scroll to the latest message
    };

    // Function to display the "bot is typing" animation
    const showLoading = () => {
        const loadingDiv = document.createElement('div');
        loadingDiv.classList.add('chat-message', 'bot', 'loading');
        loadingDiv.id = 'loading-indicator';
        loadingDiv.innerHTML = `<p><span></span><span></span><span></span></p>`;
        chatBody.appendChild(loadingDiv);
        chatBody.scrollTop = chatBody.scrollHeight;
    };

    // Function to remove the "bot is typing" animation
    const hideLoading = () => {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.remove();
        }
    };

    // Main function to handle sending a message
    const handleSendMessage = async () => {
        const query = input.value.trim();
        if (query === '') return;

        addMessage(query, 'user');
        input.value = '';
        showLoading();

        try {
            // Send the user's query to the backend API
            const response = await fetch('/api/chatbot', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query }),
            });

            hideLoading();

            if (!response.ok) {
                throw new Error('Network response was not ok.');
            }

            const data = await response.json();
            
            // Display the AI's response or an error message
            if (data.success && data.response) {
                addMessage(data.response, 'bot', { query, response: data.response });
            } else {
                addMessage(data.message || 'Sorry, something went wrong.', 'bot');
            }
        } catch (error) {
            console.error('Chatbot fetch error:', error);
            hideLoading();
            addMessage('I am having trouble connecting. Please try again later.', 'bot');
        }
    };

    // Event listeners for sending a message
    if (sendBtn) {
        sendBtn.addEventListener('click', handleSendMessage);
    }
    
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSendMessage();
            }
        });
    }
});