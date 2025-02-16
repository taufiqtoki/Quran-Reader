import { 
    openDB, 
    setPdfDoc, 
    renderPage, 
    queueRenderPage, 
    jumpToPage, 
    zoomIn, 
    updateBookmarkList, 
    addBookmarkModal, 
    saveBookmark, 
    closeModal, 
    jumpToBookmark, 
    editBookmark, 
    deleteBookmark, 
    confirmDeleteBookmark, 
    toggleFullScreen, 
    updateStarColor,
    handleModalKeyDown,
    handleMouseUpDown, // Import it from pdfManager.js
    setPageNum,
    initializePdf,
    goToNextPage,
    goToPreviousPage,
    goToFirstPage,
    goToLastPage
} from './pdfManager.js';
import { signUpWithEmail, signInWithEmail, showSigninModal, showSignupModal, closeSigninModal, closeSignupModal, handleSignin, handleSignup, handleGoogleSignIn, handlePasswordReset } from './auth.js';
import { showToast } from './utils.js';
import { setupModalFocus } from './modalUtils.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const DEFAULT_PDF_PATH = './assets/book.pdf';
let pdfPath = localStorage.getItem('pdfPath') || DEFAULT_PDF_PATH;
let pdfDoc = null;
let pageNum = localStorage.getItem('lastPage') ? parseInt(localStorage.getItem('lastPage'), 10) : 1;
let scale = window.devicePixelRatio || 1;

const updateLoadingProgress = (progress) => {
  const progressBar = document.querySelector('.loading-progress-bar');
  const loadingText = document.querySelector('.loading-text');
  if (progressBar && loadingText) {
    const percentage = Math.round(progress * 100);
    progressBar.style.width = `${percentage}%`;
    loadingText.textContent = `Loading PDF... ${percentage}%`;
  }
};

const loadPDFWithRetry = async (url, retries = 3, delay = 1000) => {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            const loadingTask = pdfjsLib.getDocument({
                url: url,
                cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/cmaps/',
                cMapPacked: true,
                enableXfa: true,
                maxImageSize: -1,  // No size limit
                disableFontFace: false,
                disableRange: false,
                disableStream: false,
                disableAutoFetch: false,
                standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/standard_fonts/',
                rangeChunkSize: 65536, // 64KB chunks
                length: 31373414  // Exact file size in bytes
            });
            
            loadingTask.onProgress = function(data) {
                const progress = data.loaded / (data.total || 31373414);
                updateLoadingProgress(Math.min(progress, 1));
            };

            const doc = await loadingTask.promise;
            console.log('PDF loaded successfully with size:', doc.numPages);
            return doc;
        } catch (error) {
            console.error(`Attempt ${i + 1} failed:`, error);
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            lastError = error;
        }
    }
    throw lastError;
};

const retryLoadPDF = () => {
  document.getElementById('loading').innerHTML = `
    <div class="spinner"></div>
    <div class="loading-text">Retrying to load PDF...</div>
    <div class="loading-progress">
      <div class="loading-progress-bar" style="width: 0%"></div>
    </div>
  `;
  initializePdf();
};

window.retryLoadPDF = retryLoadPDF;

const startApp = async () => {
    const lastPage = localStorage.getItem('lastPage');
    if (lastPage) {
        setPageNum(parseInt(lastPage, 10));
    }
    await initializePdf();
};

startApp();

let xDown = null, yDown = null, focusedElement = null, debounceTimeout;
let wakeLock = null;
let wakeLockInterval = null;

const setFocus = (element) => { focusedElement = element; };
const clearFocus = (element) => { if (focusedElement === element) focusedElement = null; };

const debounce = (func, delay) => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(func, delay);
};

const handleKeyDown = (event) => {
    if (event.target.tagName === 'INPUT' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.isContentEditable
    ) {
        return;
    }

    // Check if any modal is open
    const modalsOpen = ['signup-modal', 'signin-modal', 'bookmark-modal']
        .some(id => !document.getElementById(id).classList.contains('hidden'));
    
    if (modalsOpen) {
        if (event.key === 'Escape') {
            // ... existing modal escape handling ...
        }
        return;
    }

    // Use immediate execution for navigation keys
    switch (event.key) {
        case 'ArrowUp':
            event.preventDefault();
            goToPreviousPage();
            break;
        case 'ArrowDown':
            event.preventDefault();
            goToNextPage();
            break;
        case 'ArrowLeft':
        case 'p':
        case 'P':
            event.preventDefault();
            goToPreviousPage();
            break;
        case 'ArrowRight':
        case 'PageDown':
        case ' ':  // Space key
        case 'Enter':
        case 'n':
        case 'N':
            event.preventDefault();
            if (focusedElement !== 'input') {
                goToNextPage();
            }
            break;
        case 'Home':
            event.preventDefault();
            goToFirstPage();
            break;
        case 'End':
            event.preventDefault();
            goToLastPage();
            break;
        case 'f':
        case 'F':
            event.preventDefault();
            toggleFullScreen();
            break;
        case 'b':
        case 'B':
            event.preventDefault();
            addBookmarkModal();
            break;
    }

    // Use debounce only for non-navigation shortcuts
    debounce(() => {
        if (event.ctrlKey && event.key === 'b') {
            addBookmarkModal();
        } else if (event.ctrlKey && event.key === ' ') {
            addBookmarkModal();
        } else if (event.ctrlKey && event.key === 'Enter') {
            toggleFullScreen();
        } else if (event.key === '*') {
            addBookmarkModal();
        }
    }, 200);
};

// Make handleKeyDown globally available
window.handleKeyDown = handleKeyDown;

const toggleControls = () => {
    const controlSection = document.getElementById('control-section');
    const threeDashButton = document.getElementById('three-dash-button');
    
    if (!controlSection) return;
    
    if (window.matchMedia("(orientation: portrait)").matches) {
        if (controlSection.classList.contains('show')) {
            // Hide with animation
            controlSection.classList.add('hide');
            controlSection.classList.remove('show');
            
            if (threeDashButton) {
                threeDashButton.style.pointerEvents = 'auto';
                threeDashButton.style.opacity = '1';
            }
            
            setTimeout(() => {
                controlSection.style.visibility = 'hidden';
            }, 300);
        } else {
            // Show with animation
            controlSection.style.visibility = 'visible';
            
            if (threeDashButton) {
                threeDashButton.style.pointerEvents = 'none';
                threeDashButton.style.opacity = '0.5';
            }
            
            void controlSection.offsetWidth;
            controlSection.classList.remove('hide');
            controlSection.classList.add('show');
        }
    } else {
        controlSection.classList.toggle('hidden');
    }
};

document.addEventListener('click', (event) => {
    const controlSection = document.getElementById('control-section');
    const threeDashButton = document.getElementById('three-dash-button');
    
    // Add null checks
    if (!controlSection || !threeDashButton) return;
    
    // If in portrait mode and control section is visible
    if (window.matchMedia("(orientation: portrait)").matches && 
        controlSection.classList.contains('show')) {
        
        // Check if click is outside control section and not on the toggle button
        if (!controlSection.contains(event.target) && 
            !threeDashButton.contains(event.target)) {
            toggleControls();
        }
    }
});

const handleWheel = (event) => { debounce(() => { if (event.deltaY > 0) goToNextPage(); else goToPreviousPage(); }, 100); };

// Remove the duplicate definition
// const handleMouseUpDown = (event) => { ... }; // REMOVE THIS

const handleResize = () => {
    debounce(() => {
        pageNum = parseInt(localStorage.getItem('lastPage'), 10) || pageNum; // Ensure the correct page is rendered when the screen size changes
        queueRenderPage(pageNum);
        const pdfViewer = document.querySelector('.pdf-viewer');
        if (window.matchMedia("(orientation: landscape)").matches) {
            pdfViewer.style.width = '40%'; // Adjust width to 40% in landscape mode
            pdfViewer.style.zIndex = '900'; // Ensure the PDF viewer is below the bookmarks and control sections
        } else {
            pdfViewer.style.width = '100%'; // Reset width in portrait mode
            pdfViewer.style.zIndex = '1'; // Reset z-index in portrait mode
        }
    }, 300);
};

const handleOrientationChange = () => {
    pageNum = parseInt(localStorage.getItem('lastPage'), 10) || pageNum; // Ensure the correct page is rendered when the orientation changes
    queueRenderPage(pageNum);
    const controlSection = document.getElementById('control-section');
    const bookmarkSection = document.getElementById('bookmark-section');
    const pdfViewer = document.querySelector('.pdf-viewer');
    if (window.matchMedia("(orientation: landscape)").matches) {
        controlSection.classList.add('hidden'); // Hide controls section in landscape mode
        bookmarkSection.classList.add('hidden'); // Hide bookmarks section in landscape mode
        pdfViewer.style.width = '40%'; // Adjust width to 40% in landscape mode
        pdfViewer.style.zIndex = '900'; // Ensure the PDF viewer is below the bookmarks and control sections
    } else {
        pdfViewer.style.width = '100%'; // Reset width in portrait mode
        pdfViewer.style.zIndex = '1'; // Reset z-index in portrait mode
    }
};

const handlePageInputKeyDown = (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        jumpToPage();
    }
};

const closeConfirmDeleteModal = () => {
    const modal = document.getElementById('confirm-delete-modal');
    modal.classList.add('hidden');
    modal.setAttribute('inert', '');
};

const toggleBookmarks = () => {
    const bookmarkSection = document.getElementById('bookmark-section');
    bookmarkSection.classList.toggle('hidden');
    bookmarkSection.classList.toggle('slide-in-left');
};

const requestWakeLock = async () => {
    try {
        if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock is active');
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock was released');
                wakeLock = null;
            });
        }
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            console.info('Wake Lock not available - page not visible');
        } else {
            console.info('Wake Lock not available:', err.name, err.message);
        }
        // Retry wake lock after a delay if it failed
        setTimeout(requestWakeLock, 1000);
    }
};

const releaseWakeLock = () => {
    if (wakeLock !== null) {
        wakeLock.release().then(() => {
            wakeLock = null;
        });
    }
    if (wakeLockInterval !== null) {
        clearInterval(wakeLockInterval);
        wakeLockInterval = null;
    }
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // Add small delay to ensure the page is fully visible
        setTimeout(requestWakeLock, 100);
    } else {
        releaseWakeLock();
    }
});

// Add periodic wake lock refresh
setInterval(() => {
    if (document.visibilityState === 'visible' && !wakeLock) {
        requestWakeLock();
    }
}, 30000); // Check every 30 seconds

window.addEventListener('beforeunload', releaseWakeLock);

document.addEventListener('DOMContentLoaded', () => {
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const goToPageBtn = document.getElementById('go-to-page');
    const addBookmarkModalBtn = document.getElementById('add-bookmark-modal');
    const addBookmarkModalTopBtn = document.getElementById('add-bookmark-modal-top');
    const saveBookmarkBtn = document.getElementById('save-bookmark');
    const cancelModalBtn = document.getElementById('cancel-modal');
    const zoomInBtn = document.getElementById('zoom-in');
    const fullscreenBtn = document.getElementById('fullscreen');
    const pageInput = document.getElementById('page-input');
    const pdfViewer = document.querySelector('.pdf-viewer');
    const showControlsBtn = document.getElementById('show-controls');
    const backButton = document.getElementById('back-button');
    const threeDashButton = document.getElementById('three-dash-button');
    const signInBtn = document.getElementById('signin-btn');
    const emailSignupBtn = document.getElementById('email-signup-btn'); // Single declaration here

    const addEventListenerIfExists = (element, event, handler) => {
        if (element) element.addEventListener(event, handler);
    };

    addEventListenerIfExists(prevPageBtn, 'click', goToPreviousPage);
    addEventListenerIfExists(nextPageBtn, 'click', (e) => {
        e.stopPropagation();
        goToNextPage();
    });
    addEventListenerIfExists(goToPageBtn, 'click', () => {
        jumpToPage();
        toggleControls();
        if (pageInput) pageInput.value = '';
    });
    addEventListenerIfExists(addBookmarkModalBtn, 'click', addBookmarkModal);
    addEventListenerIfExists(addBookmarkModalTopBtn, 'click', addBookmarkModal);
    addEventListenerIfExists(saveBookmarkBtn, 'click', saveBookmark);
    addEventListenerIfExists(cancelModalBtn, 'click', closeModal);
    addEventListenerIfExists(zoomInBtn, 'click', zoomIn);
    addEventListenerIfExists(fullscreenBtn, 'click', () => {
        toggleFullScreen();
        toggleControls();
    });
    addEventListenerIfExists(pageInput, 'keydown', (event) => {
        handlePageInputKeyDown(event);
        if (event.key === 'Enter') {
            toggleControls();
        }
    });
    addEventListenerIfExists(pageInput, 'focus', () => setFocus('input'));
    addEventListenerIfExists(pageInput, 'blur', () => clearFocus('input'));
    addEventListenerIfExists(showControlsBtn, 'click', () => {
        document.getElementById('control-section').classList.toggle('hidden');  
    });
    addEventListenerIfExists(backButton, 'click', () => {
        window.history.back();
    });
    addEventListenerIfExists(threeDashButton, 'click', toggleControls);
    addEventListenerIfExists(emailSignupBtn, 'click', showSignupModal);

    if (pdfViewer) {
        pdfViewer.style.zIndex = '1'; // Set z-index to a low value
        pdfViewer.addEventListener('wheel', handleWheel);
        pdfViewer.addEventListener('mousedown', handleMouseUpDown); // Use the imported function
        pdfViewer.ondblclick = toggleFullScreen;
    }
    document.body.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);
    document.addEventListener('fullscreenchange', handleResize);
    updateBookmarkList();

    // Automatically click the zoom-in button once after every reload
    if (zoomInBtn) {
        zoomInBtn.click();
    }

    requestWakeLock();

    // Handle user section visibility in portrait mode
    const handleUserSectionVisibility = () => {
        const userSection = document.querySelector('.user-section-container');
        if (window.matchMedia("(orientation: portrait)").matches) {
            userSection.classList.toggle('expanded');
        }
    };

    // Add click handler to user section in portrait mode
    const userAvatarOrSignIn = document.getElementById('user-avatar') || document.getElementById('signin-btn');
    if (userAvatarOrSignIn) {
        userAvatarOrSignIn.addEventListener('click', handleUserSectionVisibility);
    }

    // Handle orientation changes
    window.addEventListener('orientationchange', () => {
        const userSection = document.querySelector('.user-section-container');
        if (window.matchMedia("(orientation: landscape)").matches) {
            userSection.classList.remove('expanded');
        }
    });

    // Add click handler to three-dash button for user section
    if (threeDashButton) {
        threeDashButton.addEventListener('click', (e) => {
            e.stopPropagation();
            handleUserSectionVisibility();
        });
    }

    // Close user section when clicking outside
    document.addEventListener('click', (e) => {
        const userSection = document.querySelector('.user-section-container');
        if (!userSection.contains(e.target) && !threeDashButton.contains(e.target)) {
            userSection.classList.remove('expanded');
        }
    });

    // Add new modal event listeners
    const modals = ['signin-modal', 'signup-modal', 'bookmark-modal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    if (modalId === 'signin-modal') closeSigninModal();
                    else if (modalId === 'signup-modal') closeSignupModal();
                    else if (modalId === 'bookmark-modal') closeModal();
                }
            });
        }
    });

    // Add modal focus setup to imported functions
    const originalShowSignupModal = showSignupModal;
    const originalShowSigninModal = showSigninModal;
    const originalAddBookmarkModal = addBookmarkModal;

    window.showSignupModal = () => {
        originalShowSignupModal();
        setupModalFocus('signup-modal', 'signup-submit', 'signup-close');
    };

    window.showSigninModal = () => {
        originalShowSigninModal();
        setupModalFocus('signin-modal', 'signin-submit', 'signin-close');
    };

    window.addBookmarkModal = () => {
        originalAddBookmarkModal();
        setupModalFocus('bookmark-modal', 'save-bookmark', 'cancel-modal');
    };

    // Add click handler for empty space in control section
    const controlSection = document.getElementById('control-section');
    if (controlSection) {
        controlSection.addEventListener('click', (e) => {
            // Check if click was directly on the control section (empty space)
            if (e.target === controlSection) {
                toggleControls();
            }
        });

        // Prevent clicks on control section content from closing it
        const controlContent = controlSection.querySelector('.space-y-2');
        if (controlContent) {
            controlContent.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }

    // Update sign in button event listener
    if (signInBtn) {
        signInBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showSigninModal();
        });
    }

    if (emailSignupBtn) {
        emailSignupBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showSignupModal();
        });
    }

    // Add event listener for sign-up button
    const signUpBtn = document.getElementById('signup-btn');
    if (signUpBtn) {
        signUpBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showSignupModal();
        });
    }

    // Add event listener for sign-up submit button
    const signupSubmitBtn = document.getElementById('signup-submit');
    if (signupSubmitBtn) {
        signupSubmitBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleSignup(e);
        });
    }

    // Update Google sign-in button handler
    const googleSignInBtn = document.getElementById('google-signin-btn');
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Disable the button immediately
            googleSignInBtn.disabled = true;
            googleSignInBtn.style.opacity = '0.7';
            
            try {
                await handleGoogleSignIn();
            } catch (error) {
                console.error('Google sign in error:', error);
            } finally {
                // Re-enable the button after a delay
                setTimeout(() => {
                    googleSignInBtn.disabled = false;
                    googleSignInBtn.style.opacity = '1';
                }, 2000);
            }
        });
    }

    // Update bookmark star buttons with proper event listeners
    const bookmarkStarButtons = [
        document.getElementById('add-bookmark-modal-top'),
        document.getElementById('add-bookmark-modal')
    ];

    bookmarkStarButtons.forEach(button => {
        if (button) {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                addBookmarkModal();
                updateStarColor(); // Update star color after opening modal
            });
        }
    });

    // Update star color on initial load
    updateStarColor();

    // Also update star color whenever bookmarks change
    window.addEventListener('bookmarksUpdated', () => {
        updateStarColor();
    });

    // Fix bookmark sidebar toggle buttons
    const showBookmarksBtn = document.getElementById('show-bookmarks');
    const toggleBookmarksSidebarBottomBtn = document.getElementById('toggle-bookmarks-sidebar-bottom');

    const handleBookmarkToggle = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const bookmarkSection = document.getElementById('bookmark-section');
        if (bookmarkSection) {
            if (bookmarkSection.classList.contains('hidden')) {
                bookmarkSection.classList.remove('hidden');
                bookmarkSection.classList.add('slide-in-left');
            } else {
                bookmarkSection.classList.add('hidden');
                bookmarkSection.classList.remove('slide-in-left');
            }
            updateBookmarkList(); // Refresh bookmarks when showing
        }
    };

    // Update event listeners for both bookmark toggle buttons
    if (showBookmarksBtn) {
        showBookmarksBtn.addEventListener('click', handleBookmarkToggle);
    }
    if (toggleBookmarksSidebarBottomBtn) {
        toggleBookmarksSidebarBottomBtn.addEventListener('click', handleBookmarkToggle);
    }
});

window.jumpToBookmark = jumpToBookmark;
window.setFocus = setFocus;
window.clearFocus = clearFocus;
window.zoomIn = zoomIn;
window.handleKeyDown = handleKeyDown;
window.editBookmark = editBookmark;
window.deleteBookmark = deleteBookmark;
window.goToPreviousPage = goToPreviousPage;
window.goToNextPage = goToNextPage;
window.jumpToPage = jumpToPage;
window.toggleFullScreen = toggleFullScreen;
window.addBookmarkModal = addBookmarkModal;
window.saveBookmark = saveBookmark;
window.closeModal = closeModal;
window.updateBookmarkList = updateBookmarkList;
window.confirmDeleteBookmark = confirmDeleteBookmark;
window.closeConfirmDeleteModal = closeConfirmDeleteModal;
window.toggleBookmarks = toggleBookmarks;
window.updateStarColor = updateStarColor;
window.handlePageInputKeyDown = handlePageInputKeyDown;
window.retryLoadPDF = retryLoadPDF;
window.showSignupModal = showSignupModal;
window.closeSignupModal = closeSignupModal;
window.handleSignup = handleSignup;
window.showSigninModal = showSigninModal;
window.closeSigninModal = closeSigninModal;
window.handleSignin = handleSignin;
window.handleGoogleSignIn = handleGoogleSignIn;
window.handlePasswordReset = handlePasswordReset;
window.handleModalKeyDown = handleModalKeyDown;
window.handleMouseUpDown = handleMouseUpDown;
window.toggleControls = toggleControls;
window.goToFirstPage = goToFirstPage;
window.goToLastPage = goToLastPage;
