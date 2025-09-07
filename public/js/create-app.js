// public/js/create-app.js
document.getElementById('create-app-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('app-name').value;
  const description = document.getElementById('app-description').value;
  const code = document.getElementById('app-code').value;
  const iconInput = document.getElementById('app-icon');
  const errorMessage = document.getElementById('error-message');
  const successMessage = document.getElementById('success-message');

  const formData = new FormData();
  formData.append('app-name', name);
  formData.append('app-description', description);
  formData.append('app-code', code);
  if (iconInput.files[0]) {
    formData.append('icon', iconInput.files[0]);
  }

  try {
    const response = await fetch('/api/applications/create', {
      method: 'POST',
      body: formData
    });
    const result = await response.json();
    if (result.success) {
      successMessage.textContent = 'Application saved successfully!';
      successMessage.style.display = 'block';
      errorMessage.style.display = 'none';
      document.getElementById('create-app-form').reset();
      document.getElementById('image-preview').innerHTML = '';
      setTimeout(() => {
        window.location.href = '/applications';
      }, 1000);
    } else {
      errorMessage.textContent = result.message || 'Failed to save application';
      errorMessage.style.display = 'block';
      successMessage.style.display = 'none';
    }
  } catch (err) {
    errorMessage.textContent = 'Error saving application';
    errorMessage.style.display = 'block';
    successMessage.style.display = 'none';
    console.error('Error:', err);
  }
});

function previewImage(event) {
  const input = event.target;
  const preview = document.getElementById('image-preview');
  preview.innerHTML = '';

  if (input.files && input.files[0]) {
    const file = input.files[0];
    const validTypes = ['image/jpeg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      document.getElementById('error-message').textContent = 'Please upload a JPG, JPEG, or PNG image.';
      document.getElementById('error-message').style.display = 'block';
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
      const img = document.createElement('img');
      img.src = e.target.result;
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  }
}

document.getElementById('test-app').addEventListener('click', () => {
  const code = document.getElementById('app-code').value;
  const previewContainer = document.getElementById('preview-container');
  const previewContent = document.getElementById('preview-content');

  previewContainer.style.display = 'block';
  previewContent.innerHTML = '';

  try {
    const script = document.createElement('script');
    script.textContent = code;
    previewContent.appendChild(script);
  } catch (err) {
    previewContent.innerHTML = '<p style="color: red;">Error running code: ' + err.message + '</p>';
  }
});