import { queueRenderPage } from './pdf.js';

let bookmarks = JSON.parse(localStorage.getItem('bookmarks')) || [];
let pageNum = localStorage.getItem('lastPage') ? parseInt(localStorage.getItem('lastPage'), 10) : 1; // Define pageNum

const updateBookmarkList = () => {
  const bookmarkList = document.getElementById('bookmark-list');
  bookmarkList.innerHTML = '';
  bookmarks.forEach((bookmark, index) => {
    const li = document.createElement('li');
    li.className = 'flex justify-between items-center bg-gray-200 px-4 py-2 rounded';
    li.innerHTML = `<span class="cursor-pointer" onclick="jumpToBookmark(${bookmark.page})">${bookmark.name} (Page ${bookmark.page})</span>
      <div class="flex space-x-2">
        <button class="text-blue-500" onclick="editBookmark(${index})">✎</button>
        <button class="text-red-500" onclick="deleteBookmark(${index})">✖</button>
      </div>`;
    bookmarkList.appendChild(li);
  });
  localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
};

const jumpToBookmark = (page) => {
  pageNum = page;
  queueRenderPage(pageNum);
};

const addBookmarkModal = () => {
  document.getElementById('modal-page-number').value = pageNum;
  document.getElementById('modal-bookmark-name').value = 'Continue';
  document.getElementById('bookmark-modal').classList.remove('hidden');
};

const saveBookmark = () => {
  const page = parseInt(document.getElementById('modal-page-number').value, 10);
  const name = document.getElementById('modal-bookmark-name').value.trim();

  if (!page || !name) {
    alert('Please enter both a page number and a bookmark name.');
    return;
  }

  bookmarks.push({ page, name });
  updateBookmarkList();
  closeModal();
  updateStarColor();
};

const editBookmark = (index) => {
  const bookmark = bookmarks[index];
  document.getElementById('modal-page-number').value = bookmark.page;
  document.getElementById('modal-bookmark-name').value = bookmark.name;
  document.getElementById('bookmark-modal').classList.remove('hidden');

  const saveButton = document.getElementById('save-bookmark');
  saveButton.onclick = () => {
    bookmarks[index] = {
      page: parseInt(document.getElementById('modal-page-number').value, 10),
      name: document.getElementById('modal-bookmark-name').value.trim()
    };
    updateBookmarkList();
    closeModal();
  };

  document.getElementById('bookmark-modal').onkeydown = (event) => {
    if (event.key === 'Enter') {
      saveButton.click();
    }
  };
};

const deleteBookmark = (index) => {
  if (confirm('Are you sure you want to delete this bookmark?')) {
    bookmarks.splice(index, 1);
    updateBookmarkList();
  }
};

const closeModal = () => {
  document.getElementById('bookmark-modal').classList.add('hidden');
};

const updateStarColor = () => {
  const addBookmarkButton = document.getElementById('add-bookmark-modal');
  const isBookmarked = bookmarks.some(bookmark => bookmark.page === pageNum);
  addBookmarkButton.style.color = isBookmarked ? 'blue' : 'black';
};

export { updateBookmarkList, jumpToBookmark, addBookmarkModal, saveBookmark, editBookmark, deleteBookmark, closeModal, updateStarColor };
