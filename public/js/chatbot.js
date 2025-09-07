document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('chatbot-toggle-btn');
    const closeBtn = document.getElementById('chatbot-close-btn');
    const sendBtn = document.getElementById('chatbot-send-btn');
    const input = document.getElementById('chatbot-input');
    const container = document.getElementById('chatbot-container');
    const chatBody = document.getElementById('chatbot-body');

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
    
    // Function to add a new message to the chat window
    const addMessage = (text, sender) => {
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
                addMessage(data.response, 'bot');
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