document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // ----- Quill Editor Setup -----
  if (document.getElementById('publication-editor')) {
    const quill = new Quill('#publication-editor', {
      theme: 'snow',
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline', 'link'],
          [{ 'list': 'ordered' }, { 'list': 'bullet' }],
          [{ 'color': [] }, { 'background': [] }],
          [{ 'font': [] }],
          [{ 'align': [] }],
          ['clean']
        ]
      },
      placeholder: 'Write your publication content here...'
    });

    const publicationForm = document.getElementById('create-publication-form');
    const submitButton = document.getElementById('submit-publication');
    const filesInput = document.getElementById('publication-files');
    const previewsContainer = document.getElementById('file-previews');
    const errorDiv = document.getElementById('publicationError');
    const successDiv = document.getElementById('publicationSuccess');

    // Handle file previews
    if (filesInput && previewsContainer) {
      filesInput.addEventListener('change', () => {
        previewsContainer.innerHTML = ''; // Clear previous previews
        const files = filesInput.files;

        if (files.length > 10) {
          alert('You can only upload a maximum of 10 files.');
          filesInput.value = ''; // Reset input
          return;
        }

        for (const file of files) {
          const previewWrapper = document.createElement('div');
          previewWrapper.className = 'relative border rounded-lg p-1';

          if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
              const img = document.createElement('img');
              img.src = e.target.result;
              img.className = 'w-full h-24 object-cover rounded-md';
              previewWrapper.appendChild(img);
            };
            reader.readAsDataURL(file);
          } else if (file.type === 'application/pdf') {
            const pdfPreview = document.createElement('div');
            pdfPreview.className = 'flex flex-col items-center justify-center h-24';
            pdfPreview.innerHTML = `
              <i class="fas fa-file-pdf text-red-500 text-3xl"></i>
              <span class="text-xs mt-2 truncate w-full text-center px-1">${file.name}</span>
            `;
            previewWrapper.appendChild(pdfPreview);
          }
          previewsContainer.appendChild(previewWrapper);
        }
      });
    }

    // Handle form submission
    if (publicationForm) {
      publicationForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = quill.root.innerHTML.trim();
        if (!content || content === '<p><br></p>' || content === '<p></p>') {
          errorDiv.textContent = 'Please enter some content';
          errorDiv.classList.remove('hidden');
          successDiv.classList.add('hidden');
          return;
        }

        const formData = new FormData();
        formData.append('content', content);

        if (filesInput.files.length > 0) {
          for (let i = 0; i < filesInput.files.length; i++) {
            formData.append('files', filesInput.files[i]);
          }
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
          submitButton.textContent = 'Post';

          if (result.success) {
            quill.setContents([]);
            filesInput.value = '';
            previewsContainer.innerHTML = '';
            successDiv.textContent = 'Publication posted successfully!';
            successDiv.classList.remove('hidden');
            errorDiv.classList.add('hidden');
            setTimeout(() => successDiv.classList.add('hidden'), 3000);
          } else {
            errorDiv.textContent = result.message || 'Failed to post publication';
            errorDiv.classList.remove('hidden');
            successDiv.classList.add('hidden');
          }
        } catch (err) {
          console.error('Error posting publication:', err);
          errorDiv.textContent = 'An unexpected error occurred.';
          errorDiv.classList.remove('hidden');
          successDiv.classList.add('hidden');
          submitButton.disabled = false;
          submitButton.textContent = 'Post';
        }
      });
    }
  }
  
  // ----- MASTER FUNCTION TO SETUP LISTENERS FOR ANY POST -----
  function setupPublicationListeners(publicationElement) {
    const publicationId = publicationElement.dataset.publicationId;

    // 1. Like Button
    const likeButton = publicationElement.querySelector('.like-button');
    if (likeButton) {
      likeButton.addEventListener('click', () => {
        fetch(`/publication/${publicationId}/like`, { method: 'POST' });
      });
    }

    // 2. Comment Toggle
    const commentToggle = publicationElement.querySelector('.comment-toggle');
    if (commentToggle) {
      commentToggle.addEventListener('click', () => {
        const commentSection = publicationElement.querySelector('.comment-section');
        commentSection.classList.toggle('hidden');
      });
    }

    // 3. Comment Form Submission
    const commentForm = publicationElement.querySelector('.comment-form');
    if (commentForm) {
      commentForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = commentForm.querySelector('input[name="content"]');
        const content = input.value.trim();
        if (content && window.currentUserId) {
          socket.emit('commentPublication', {
            userId: window.currentUserId,
            publicationId: publicationId,
            content: content
          });
          input.value = ''; // Clear input after sending
        }
      });
    }

    // 4. Image Carousel Logic
    const carousel = publicationElement.querySelector('.image-carousel');
    if (carousel) {
      const images = carousel.querySelectorAll('.carousel-image');
      if (images.length > 1) {
        const prevBtn = carousel.querySelector('.carousel-button.prev');
        const nextBtn = carousel.querySelector('.carousel-button.next');
        const counter = carousel.querySelector('.carousel-counter');
        let currentIndex = 0;

        const showImage = (index) => {
          images.forEach((img, i) => img.classList.toggle('hidden', i !== index));
          if(counter) counter.textContent = `${index + 1} / ${images.length}`;
          currentIndex = index;
        };

        prevBtn.addEventListener('click', () => showImage((currentIndex - 1 + images.length) % images.length));
        nextBtn.addEventListener('click', () => showImage((currentIndex + 1) % images.length));
      }
    }
  }

  // Initial setup for server-rendered posts
  document.querySelectorAll('.publication-item').forEach(setupPublicationListeners);

  // ----- SOCKET.IO EVENT HANDLERS -----

  // Handle new publications
  socket.on('newPublication', (publication) => {
    const publicationsList = document.getElementById('publications-list');
    if (publicationsList) {
        const publicationDiv = document.createElement('div');
        publicationDiv.className = 'bg-white rounded-lg border border-gray-300 shadow-sm publication-item';
        publicationDiv.dataset.publicationId = publication._id;

        const isLiked = publication.likes && window.currentUserId && publication.likes.includes(window.currentUserId);

        let imagesHtml = '';
        if (publication.images && publication.images.length > 0) {
            const imageTags = publication.images.map((img, index) =>
                `<img src="/publication-file/${publication._id}/image/${index}" alt="Publication Image" class="carousel-image ${index === 0 ? 'block' : 'hidden'}" data-index="${index}">`
            ).join('');
            const buttonsHtml = publication.images.length > 1 ?
                `<button class="carousel-button prev"><i class="fas fa-chevron-left"></i></button>
                 <button class="carousel-button next"><i class="fas fa-chevron-right"></i></button>
                 <div class="carousel-counter">1 / ${publication.images.length}</div>` : '';
            imagesHtml = `<div class="image-carousel">${imageTags}${buttonsHtml}</div>`;
        }

        let documentsHtml = '';
        if (publication.documents && publication.documents.length > 0) {
            documentsHtml = publication.documents.map(doc =>
                `<div class="p-3">
                    <p class="font-semibold text-sm mb-2 text-gray-600">${doc.filename}</p>
                    <iframe src="/publication-file/${publication._id}/document/${doc._id}" class="w-full h-72 rounded-md border"></iframe>
                </div>`
            ).join('');
        }

        publicationDiv.innerHTML = `
            <div class="p-3">
                <div class="flex items-center mb-3">
                    <div class="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center font-bold text-gray-600 text-lg mr-2">
                        ${publication.postedBy.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <p class="font-semibold text-base text-gray-800">${publication.postedBy.username}</p>
                        <span class="text-gray-500 text-xs">${new Date(publication.createdAt).toLocaleString()}</span>
                    </div>
                </div>
                <div class="publication-content text-sm mb-3 text-gray-700">${publication.content}</div>
            </div>
            <div class="media-container space-y-2">${imagesHtml}${documentsHtml}</div>
            <div class="p-2 border-t border-gray-200">
                <div class="flex items-center justify-around">
                    <button class="like-button action-button ${isLiked ? 'liked' : ''}">
                        <i class="far fa-thumbs-up"></i>
                        <span class="like-text">${isLiked ? 'Liked' : 'Like'}</span>&nbsp;
                        (<span class="like-count">${publication.likeCount || 0}</span>)
                    </button>
                    <button class="comment-toggle action-button">
                        <i class="far fa-comment-dots"></i> Comment
                    </button>
                </div>
            </div>
            <div class="comment-section bg-gray-50 p-3 border-t border-gray-200 hidden">
                <form class="comment-form flex items-center space-x-2">
                    <input name="content" class="w-full p-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Add a comment..." required>
                    <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded-full font-semibold hover:bg-blue-700">Post</button>
                </form>
                <div class="comments-list mt-4 space-y-3"></div>
            </div>
        `;
        
        publicationsList.prepend(publicationDiv);
        setupPublicationListeners(publicationDiv); // Attach listeners to the new post
    }
  });

  socket.on('publicationLiked', ({ publicationId, likeCount, isLiked }) => {
    const publicationDiv = document.querySelector(`.publication-item[data-publication-id="${publicationId}"]`);
    if (publicationDiv) {
        const likeButton = publicationDiv.querySelector('.like-button');
        likeButton.classList.toggle('liked', isLiked);
        likeButton.querySelector('.like-text').textContent = isLiked ? 'Liked' : 'Like';
        likeButton.querySelector('.like-count').textContent = likeCount;
    }
  });

  socket.on('newComment', (comment) => {
    const commentsList = document.querySelector(`.publication-item[data-publication-id="${comment.publication}"] .comments-list`);
    if (commentsList) {
        const commentDiv = document.createElement('div');
        commentDiv.className = 'comment-item';
        commentDiv.innerHTML = `
            <p class="font-semibold text-sm text-gray-800">${comment.user.username}</p>
            <p class="text-gray-600 text-sm">${comment.content}</p>
        `;
        commentsList.appendChild(commentDiv);
    }
  });
});