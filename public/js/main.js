// Ensure dropdown menus close when clicking analyze options
document.querySelectorAll('.analyze-option').forEach(option => {
  option.addEventListener('click', (e) => {
    const dropdownMenu = e.target.closest('.dropdown-menu');
    if (dropdownMenu) {
      dropdownMenu.classList.remove('active');
    }
  });
});