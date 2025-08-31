document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // Initialize Quill editor for publication form
  if (document.getElementById('publication-editor')) {
    const quill = new Quill('#publication-editor', {
      theme: 'snow',
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline'],
          [{ 'list': 'ordered' }, { 'list': 'bullet' }],
          ['link'],
          ['clean']
        ]
      },
      placeholder: 'Write your publication content here...'
    });

    const publicationForm = document.getElementById('create-publication-form');
    const submitButton = document.getElementById('submit-publication');
    const contentInput = document.getElementById('publication-content');
    if (publicationForm && submitButton && contentInput) {
      publicationForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = quill.root.innerHTML.trim();
        console.log('Quill content:', content);
        if (!content || content === '<p><br></p>' || content === '<p></p>') {
          document.getElementById('publicationError').textContent = 'Please enter some content';
          document.getElementById('publicationError').classList.remove('hidden');
          document.getElementById('publicationSuccess').classList.add('hidden');
          return;
        }
        contentInput.value = content;
        const formData = new FormData();
        formData.append('content', content);
        const imageInput = document.getElementById('publication-image');
        if (imageInput.files[0]) {
          formData.append('image', imageInput.files[0]);
        }
        console.log('FormData entries:');
        for (let [key, value] of formData.entries()) {
          console.log(`${key}: ${value instanceof File ? value.name : value}`);
        }
        try {
          submitButton.disabled = true;
          submitButton.textContent = 'Posting...';
          const response = await fetch('/publication', {
            method: 'POST',
            body: formData
          });
          const result = await response.json();
          submitButton.disabled = false;
          submitButton.textContent = 'Post Publication';
          if (result.success) {
            quill.setContents([]);
            contentInput.value = '';
            imageInput.value = '';
            document.getElementById('publicationSuccess').textContent = 'Publication posted successfully!';
            document.getElementById('publicationSuccess').classList.remove('hidden');
            document.getElementById('publicationError').classList.add('hidden');
          } else {
            document.getElementById('publicationError').textContent = result.message || 'Failed to post publication';
            document.getElementById('publicationError').classList.remove('hidden');
            document.getElementById('publicationSuccess').classList.add('hidden');
          }
        } catch (err) {
          console.error('Error posting publication:', err);
          document.getElementById('publicationError').textContent = 'Error posting publication';
          document.getElementById('publicationError').classList.remove('hidden');
          document.getElementById('publicationSuccess').classList.add('hidden');
          submitButton.disabled = false;
          submitButton.textContent = 'Post Publication';
        }
      });
    }
  }

  // Handle like button clicks
  document.querySelectorAll('.like-button').forEach(button => {
    button.addEventListener('click', async () => {
      const publicationId = button.getAttribute('data-publication-id');
      const isLiked = button.getAttribute('data-liked') === 'true';
      try {
        const response = await fetch(`/publication/${publicationId}/like`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        if (result.success) {
          button.setAttribute('data-liked', result.isLiked);
          button.innerHTML = `
            <svg class="w-5 h-5 mr-1" fill="${result.isLiked ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
            </svg>
            <span class="like-count">${result.likeCount}</span> ${result.isLiked ? 'Unlike' : 'Like'}
          `;
          socket.emit('likePublication', { userId: window.currentUserId, publicationId });
          document.getElementById('publicationError').classList.add('hidden');
        } else {
          console.error('Like error:', result.message);
          document.getElementById('publicationError').textContent = result.message || 'Failed to like publication';
          document.getElementById('publicationError').classList.remove('hidden');
        }
      } catch (err) {
        console.error('Like request error:', err);
        document.getElementById('publicationError').textContent = 'Error liking publication';
        document.getElementById('publicationError').classList.remove('hidden');
      }
    });
  });

  // Handle comment toggle
  document.querySelectorAll('.comment-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const publicationId = button.getAttribute('data-publication-id');
      const commentForm = document.querySelector(`.comment-form[data-publication-id="${publicationId}"]`);
      const commentsList = document.querySelector(`.comments-list[data-publication-id="${publicationId}"]`);
      commentForm.classList.toggle('hidden');
      commentsList.classList.toggle('hidden');
      document.getElementById('publicationError').classList.add('hidden');
      document.getElementById('publicationSuccess').classList.add('hidden');
    });
  });

  // Handle comment form submissions
  document.querySelectorAll('.comment-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const publicationId = form.getAttribute('data-publication-id');
      const content = form.querySelector('textarea[name="content"]').value.trim();
      if (!content) {
        document.getElementById('publicationError').textContent = 'Please enter a comment';
        document.getElementById('publicationError').classList.remove('hidden');
        document.getElementById('publicationSuccess').classList.add('hidden');
        return;
      }
      try {
        console.log('Sending comment request:', { publicationId, content });
        const response = await fetch(`/publication/${publicationId}/comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
        console.log('Comment response status:', response.status, 'OK:', response.ok);
        let result;
        try {
          const text = await response.text();
          console.log('Raw response text:', text);
          result = JSON.parse(text);
          console.log('Comment response body:', result);
        } catch (jsonErr) {
          console.error('Error parsing JSON response:', jsonErr);
          throw new Error('Invalid server response format');
        }
        if (response.ok && result.success) {
          // form.reset();
          form.querySelector('textarea[name="content"]').value = '';
          form.classList.add('hidden');
          const commentsList = document.querySelector(`.comments-list[data-publication-id="${publicationId}"]`);
          if (commentsList) commentsList.classList.add('hidden');
          socket.emit('commentPublication', { userId: window.currentUserId, publicationId, content });
          document.getElementById('publicationError').classList.add('hidden');
          document.getElementById('publicationSuccess').textContent = 'Comment posted successfully!';
          document.getElementById('publicationSuccess').classList.remove('hidden');
          setTimeout(() => {
            document.getElementById('publicationSuccess').classList.add('hidden');
          }, 3000);
        } else {
          document.getElementById('publicationError').textContent = result.message || 'Failed to post comment';
          document.getElementById('publicationError').classList.remove('hidden');
          document.getElementById('publicationSuccess').classList.add('hidden');
        }
      } catch (err) {
        console.error('Comment submission error:', err.message);
        document.getElementById('publicationError').textContent = `Error posting comment: ${err.message}`;
        document.getElementById('publicationError').classList.remove('hidden');
        document.getElementById('publicationSuccess').classList.add('hidden');
      }
    });
  });

  // Socket.IO: Handle new publications
  socket.on('newPublication', (publication) => {
    const publicationsList = document.getElementById('publications-list');
    if (publicationsList) {
      const publicationDiv = document.createElement('div');
      publicationDiv.className = 'bg-white p-6 rounded-lg shadow-md publication-item';
      publicationDiv.setAttribute('data-publication-id', publication._id);
      const isLiked = publication.likes && window.currentUserId && publication.likes.some(id => id === window.currentUserId);
      publicationDiv.innerHTML = `
        <div class="flex items-center mb-4">
          <p class="font-semibold text-lg">${publication.postedBy ? publication.postedBy.username : 'Unknown User'}</p>
          <span class="text-gray-500 text-sm ml-4">${new Date(publication.createdAt).toLocaleString()}</span>
        </div>
        <div class="publication-content mb-4">${publication.content}</div>
        ${publication.image ? `<img src="/publication-image/${publication._id}" alt="Publication Image" class="max-w-full h-auto rounded-lg mb-4">` : ''}
        <div class="flex items-center space-x-4 mb-4">
          <button class="like-button flex items-center text-blue-600 hover:text-blue-800" data-publication-id="${publication._id}" data-liked="${isLiked}">
            <svg class="w-5 h-5 mr-1" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 14" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
            </svg>
            <span class="like-count">${publication.likeCount || 0}</span> ${isLiked ? 'Unlike' : 'Like'}
          </button>
          <button class="comment-toggle text-blue-600 hover:text-blue-800" data-publication-id="${publication._id}">Comment</button>
        </div>
        <div class="comment-form hidden" data-publication-id="${publication._id}">
          <form class="space-y-2">
            <textarea name="content" class="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600" rows="2" placeholder="Write a comment..." required></textarea>
            <button type="submit" class="comment-btn bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700" data-publication-id="${publication._id}">Post Comment</button>
          </form>
        </div>
        <div class="comments-list mt-4 hidden" data-publication-id="${publication._id}"></div>
      `;
      publicationsList.prepend(publicationDiv);
      attachEventListeners(publicationDiv);
    }
  });

  // Socket.IO: Handle like updates
  socket.on('publicationLiked', ({ publicationId, likeCount, isLiked }) => {
    const publicationDiv = document.querySelector(`[data-publication-id="${publicationId}"]`);
    if (publicationDiv) {
      const likeButton = publicationDiv.querySelector('.like-button');
      likeButton.setAttribute('data-liked', isLiked);
      likeButton.innerHTML = `
        <svg class="w-5 h-5 mr-1" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
        </svg>
        <span class="like-count">${likeCount}</span> ${isLiked ? 'Unlike' : 'Like'}
      `;
    }
  });

  // Socket.IO: Handle new comments
  socket.on('newComment', (comment) => {
    const publicationDiv = document.querySelector(`[data-publication-id="${comment.publication}"]`);
    if (publicationDiv) {
      const commentsList = publicationDiv.querySelector('.comments-list');
      const commentDiv = document.createElement('div');
      commentDiv.className = 'comment-item border-t pt-2';
      commentDiv.setAttribute('data-id', comment._id);
      commentDiv.innerHTML = `
        <p class="font-semibold">${comment.user ? comment.user.username : 'Unknown User'}</p>
        <p class="text-gray-500 text-sm">${new Date(comment.createdAt).toLocaleString()}</p>
        <p class="text-gray-600">${comment.content}</p>
      `;
      commentsList.appendChild(commentDiv);
      // Keep comments list hidden unless toggled
    }
  });

  // Function to attach event listeners to dynamically added elements
  function attachEventListeners(element) {
    const likeButton = element.querySelector('.like-button');
    const commentToggle = element.querySelector('.comment-toggle');
    const commentForm = element.querySelector('.comment-form');

    if (likeButton) {
      likeButton.addEventListener('click', async () => {
        const publicationId = likeButton.getAttribute('data-publication-id');
        const isLiked = likeButton.getAttribute('data-liked') === 'true';
        try {
          const response = await fetch(`/publication/${publicationId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          const result = await response.json();
          if (result.success) {
            likeButton.setAttribute('data-liked', result.isLiked);
            likeButton.innerHTML = `
              <svg class="w-5 h-5 mr-1" fill="${result.isLiked ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
              </svg>
              <span class="like-count">${result.likeCount}</span> ${result.isLiked ? 'Unlike' : 'Like'}
            `;
            socket.emit('likePublication', { userId: window.currentUserId, publicationId });
            document.getElementById('publicationError').classList.add('hidden');
          } else {
            document.getElementById('publicationError').textContent = result.message || 'Failed to like publication';
            document.getElementById('publicationError').classList.remove('hidden');
          }
        } catch (err) {
          console.error('Like request error:', err);
          document.getElementById('publicationError').textContent = 'Error liking publication';
          document.getElementById('publicationError').classList.remove('hidden');
        }
      });
    }

    if (commentToggle) {
      commentToggle.addEventListener('click', () => {
        const publicationId = commentToggle.getAttribute('data-publication-id');
        const commentForm = element.querySelector(`.comment-form[data-publication-id="${publicationId}"]`);
        const commentsList = element.querySelector(`.comments-list[data-publication-id="${publicationId}"]`);
        commentForm.classList.toggle('hidden');
        commentsList.classList.toggle('hidden');
        document.getElementById('publicationError').classList.add('hidden');
        document.getElementById('publicationSuccess').classList.add('hidden');
      });
    }

    if (commentForm) {
      commentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const publicationId = commentForm.getAttribute('data-publication-id');
        const content = commentForm.querySelector('textarea[name="content"]').value.trim();
        if (!content) {
          document.getElementById('publicationError').textContent = 'Please enter a comment';
          document.getElementById('publicationError').classList.remove('hidden');
          document.getElementById('publicationSuccess').classList.add('hidden');
          return;
        }
        try {
          console.log('Sending comment request:', { publicationId, content });
          const response = await fetch(`/publication/${publicationId}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
          });
          console.log('Comment response status:', response.status, 'OK:', response.ok);
          let result;
          try {
            const text = await response.text();
            console.log('Raw response text:', text);
            result = JSON.parse(text);
            console.log('Comment response body:', result);
          } catch (jsonErr) {
            console.error('Error parsing JSON response:', jsonErr);
            throw new Error('Invalid server response format');
          }
          if (response.ok && result.success) {
            form.reset();
            form.classList.add('hidden');
            const commentsList = element.querySelector(`.comments-list[data-publication-id="${publicationId}"]`);
            if (commentsList) commentsList.classList.add('hidden');
            socket.emit('commentPublication', { userId: window.currentUserId, publicationId, content });
            document.getElementById('publicationError').classList.add('hidden');
            document.getElementById('publicationSuccess').textContent = 'Comment posted successfully!';
            document.getElementById('publicationSuccess').classList.remove('hidden');
            setTimeout(() => {
              document.getElementById('publicationSuccess').classList.add('hidden');
            }, 3000);
          } else {
            document.getElementById('publicationError').textContent = result.message || 'Failed to post comment';
            document.getElementById('publicationError').classList.remove('hidden');
            document.getElementById('publicationSuccess').classList.add('hidden');
          }
        } catch (err) {
          console.error('Comment submission error:', err.message);
          document.getElementById('publicationError').textContent = `Error posting comment: ${err.message}`;
          document.getElementById('publicationError').classList.remove('hidden');
          document.getElementById('publicationSuccess').classList.add('hidden');
        }
      });
    }
  }
});