import { 
    auth, 
    db, 
    rtdb,
    googleProvider 
} from './firebaseConfig.js';
import { 
    signInWithPopup, 
    signInWithRedirect,
    getRedirectResult,
    GoogleAuthProvider, 
    signOut,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updateProfile,
    sendPasswordResetEmail,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { ref, onValue, getDatabase } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js';
import { showToast } from './utils.js';
import { getBookmarks, getLastRead } from './firestoreManager.js';
import { setPageNum, initializePdf } from './pdfManager.js';
import { setupModalFocus } from './modalUtils.js';

// Remove these lines since we're importing them from firebaseConfig.js
// const app = window.firebaseApp || initializeApp(firebaseConfig);
// const db = initializeFirestore(app, {...});
// const rtdb = getDatabase(app);

// Remove the deprecated call
// enableIndexedDbPersistence(db)...

// Add offline detection
let isOffline = false;

// Update connection monitoring
function initializeConnectionMonitoring() {
    try {
        const connectedRef = ref(rtdb, '.info/connected');
        onValue(connectedRef, (snap) => {
            isOffline = !snap.val();
            updateConnectionStatus();
        }, {
            // Add error handler directly
            onlyOnce: false,
            timeout: 5000
        }, (error) => {
            console.warn('Connection monitoring fallback mode:', error);
            useOfflineDetectionFallback();
        });
    } catch (error) {
        console.warn('Connection monitoring fallback mode:', error);
        useOfflineDetectionFallback();
    }
}

function useOfflineDetectionFallback() {
    window.addEventListener('online', () => {
        isOffline = false;
        updateConnectionStatus();
    });
    window.addEventListener('offline', () => {
        isOffline = true;
        updateConnectionStatus();
    });
}

function updateConnectionStatus() {
    const statusElement = document.getElementById('online-status');
    if (!statusElement) return; // Exit if status element doesn't exist
    
    if (isOffline) {
        statusElement.innerHTML = `
            <span class="w-2 h-2 bg-red-500 rounded-full mr-2"></span>
            <span class="text-gray-600">Offline</span>
        `;
        showToast('Working offline');
    } else {
        statusElement.innerHTML = `
            <span class="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
            <span class="text-gray-600">Online</span>
        `;
        showToast('Back online');
    }
}

// UI Elements with null checks
const userSection = document.getElementById('user-view');
const guestSection = document.getElementById('guest-view');
const signInButton = document.getElementById('signin-btn');
const signOutButton = document.getElementById('mini-signout-btn'); // Changed to mini-signout-btn
const userAvatar = document.getElementById('user-avatar');
const userDisplayName = document.getElementById('username-display');
const userEmail = document.getElementById('email-display');

// Add mini signout button handler
const miniSignOutButton = document.getElementById('mini-signout-btn');
if (miniSignOutButton) {
    miniSignOutButton.addEventListener('click', async () => {
        try {
            await signOut(auth);
            showToast('Signed out successfully');
        } catch (error) {
            console.error("Error signing out: ", error);
            showToast('Failed to sign out');
        }
    });
}

// Sync bookmarks with Firestore
async function syncBookmarks(userId, bookmarks) {
    // Always save to localStorage first
    localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
    
    if (isOffline) {
        showToast('Changes saved locally');
        return;
    }

    try {
        const bookmarksRef = doc(db, "bookmarks", userId);
        await setDoc(bookmarksRef, { bookmarks });
        showToast('Bookmarks synced successfully');
    } catch (error) {
        console.error("Error syncing bookmarks:", error);
        showToast('Changes saved locally');
    }
}

// Load bookmarks from Firestore
async function loadBookmarks(userId) {
    try {
        const docRef = doc(db, "bookmarks", userId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data().bookmarks;
        }
        return {};
    } catch (error) {
        console.log("Error loading bookmarks:", error);
        // If offline, try to get from localStorage
        const localBookmarks = localStorage.getItem('bookmarks');
        return localBookmarks ? JSON.parse(localBookmarks) : {};
    }
}

// Add these new functions
async function signUpWithEmail(email, password, name) {
    try {
        // First create the user
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        
        // Then update the user's profile with their name
        await updateProfile(userCredential.user, {
            displayName: name
        });

        showToast('Account created successfully');
        return userCredential.user;
    } catch (error) {
        console.error("Error creating account:", error);
        if (error.code === 'auth/email-already-in-use') {
            showToast('Email address is already in use. Please sign in instead.');
        } else {
            showToast(error.message || 'Failed to create account');
        }
        throw error;
    }
}

async function signInWithEmail(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        showToast('Signed in successfully');
        return userCredential.user;
    } catch (error) {
        console.error("Error signing in:", error);
        showToast(error.message);
        throw error;
    }
}

// Add device detection helper
const getDeviceType = () => {
    const userAgent = navigator.userAgent;
    const isEmulator = /Chrome\/\d+/.test(userAgent) && 
                      /Mobile\b/.test(userAgent) && 
                      window.matchMedia('(max-device-width: 900px)').matches;
    const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(userAgent);
    
    console.log('Device Detection:', {
        userAgent,
        isEmulator,
        isMobileDevice,
        width: window.innerWidth,
        pixelRatio: window.devicePixelRatio
    });

    return {
        isEmulator,
        isMobileDevice,
        usePopup: !isMobileDevice || isEmulator
    };
};

// Update the Google Sign-in handler
const handleGoogleSignIn = async () => {
    try {
        const device = getDeviceType();
        console.log('Device type:', device);

        // Clear any existing auth states
        localStorage.removeItem('authInProgress');
        localStorage.removeItem('redirectStartTime');

        // Set new auth state
        localStorage.setItem('authInProgress', 'true');
        localStorage.setItem('redirectStartTime', Date.now().toString());

        // Always use popup for emulator, redirect for real mobile devices
        if (device.usePopup) {
            if (window.googleSignInInProgress) {
                console.warn('Google sign-in already in progress');
                return;
            }
            
            window.googleSignInInProgress = true;
            
            try {
                // Configure provider for popup
                googleProvider.setCustomParameters({
                    prompt: 'select_account',
                    display: 'popup'
                });

                const result = await signInWithPopup(auth, googleProvider);
                if (result?.user) {
                    console.log('Popup sign-in successful');
                    updateUIForUser(result.user);
                    showToast('Signed in successfully with Google');
                }
            } catch (popupError) {
                handleSignInError(popupError);
            }
        } else {
            // Configure provider for redirect
            googleProvider.setCustomParameters({
                prompt: 'select_account',
                display: 'touch',
                redirect_uri: window.location.origin
            });

            await signInWithRedirect(auth, googleProvider);
        }
    } catch (error) {
        handleSignInError(error);
    } finally {
        window.googleSignInInProgress = false;
    }
};

// Add error handling function
const handleSignInError = (error) => {
    localStorage.removeItem('authInProgress');
    localStorage.removeItem('redirectStartTime');
    window.googleSignInInProgress = false;

    console.error("Google sign in error:", error);
    
    switch (error.code) {
        case 'auth/cancelled-popup-request':
            showToast('Sign-in was cancelled');
            break;
        case 'auth/popup-blocked':
            showToast('Please allow popups and try again');
            break;
        case 'auth/popup-closed-by-user':
            showToast('Sign-in window was closed');
            break;
        case 'auth/internal-error':
            showToast('Please try signing in again');
            break;
        default:
            showToast(error.message || 'Failed to sign in with Google');
    }
};

// Add password reset function
const handlePasswordReset = async (email) => {
    try {
        await sendPasswordResetEmail(auth, email);
        showToast('Password reset email sent! Please check your inbox.');
        closeSigninModal();
    } catch (error) {
        console.error("Password reset error:", error);
        showToast(error.message || 'Failed to send reset email');
    }
};

// Update the UI update function
const updateUIForUser = (user) => {
    console.log('Updating UI for user:', user); // Debug log

    // Get UI elements
    const userView = document.getElementById('user-view');
    const guestView = document.getElementById('guest-view');
    const userAvatar = document.getElementById('user-avatar');
    const displayName = document.getElementById('username-display');
    const emailDisplay = document.getElementById('email-display');

    // Log element existence
    console.log('Elements found:', {
        userView: !!userView,
        guestView: !!guestView,
        userAvatar: !!userAvatar,
        displayName: !!displayName,
        emailDisplay: !!emailDisplay
    });

    // Ensure all elements exist
    if (!userView || !guestView || !userAvatar || !displayName || !emailDisplay) {
        console.error('Some UI elements are missing');
        return;
    }

    try {
        // Update visibility
        userView.classList.remove('hidden');
        guestView.classList.add('hidden');

        // Update user info
        const nameInitial = (user.displayName || user.email || 'U')[0].toUpperCase();
        userAvatar.textContent = nameInitial;
        userAvatar.classList.add('w-10', 'h-10', 'flex', 'items-center', 'justify-center');
        
        displayName.textContent = user.displayName || 'User';
        emailDisplay.textContent = user.email;

        // Ensure elements are visible
        userView.style.display = 'block';
        guestView.style.display = 'none';

        console.log('UI updated successfully');
    } catch (error) {
        console.error('Error updating UI:', error);
    }
};

// Update the auth state observer with better last page handling
auth.onAuthStateChanged(async (user) => {
    if (user) {
        updateUIForUser(user);
        const lastReadPage = await getLastRead(user.uid);
        if (lastReadPage && typeof lastReadPage === 'number') {
            setPageNum(lastReadPage);
            await initializePdf(lastReadPage);
        }
        
        const bookmarks = await getBookmarks(user.uid);
        window.bookmarks = bookmarks || {};
        if (typeof window.updateBookmarkList === 'function') {
            window.updateBookmarkList();
        }
    } else {
        // Reset UI for guest
        const userView = document.getElementById('user-view');
        const guestView = document.getElementById('guest-view');
        
        if (userView && guestView) {
            userView.classList.add('hidden');
            guestView.classList.remove('hidden');
            
            // Ensure visibility
            userView.style.display = 'none';
            guestView.style.display = 'block';
        }
        
        // Clear local data
        localStorage.removeItem('bookmarks');
        window.bookmarks = {};
    }
});

// Update the redirect result handler
const handleRedirectResult = async () => {
    try {
        console.log('Checking redirect result...');
        const result = await getRedirectResult(auth);
        
        localStorage.removeItem('authInProgress');
        localStorage.removeItem('redirectStartTime');
        
        if (result?.user) {
            console.log('Redirect sign-in successful');
            updateUIForUser(result.user);
            showToast('Signed in successfully with Google');
            return true;
        } else {
            console.log('No redirect result found');
            return false;
        }
    } catch (error) {
        console.error('Redirect result error:', error);
        localStorage.removeItem('authInProgress');
        localStorage.removeItem('redirectStartTime');
        showToast('Sign-in failed: ' + (error.message || 'Unknown error'));
        return false;
    }
};

// Update DOMContentLoaded handler
document.addEventListener('DOMContentLoaded', async () => {
    if (localStorage.getItem('authInProgress')) {
        const success = await handleRedirectResult();
        if (!success) {
            console.log('Redirect sign-in failed or was cancelled');
        }
    }
});

// Add a periodic check for stuck redirects
setInterval(() => {
    const redirectStartTime = localStorage.getItem('redirectStartTime');
    if (redirectStartTime) {
        const timeElapsed = Date.now() - parseInt(redirectStartTime);
        if (timeElapsed > 120000) { // 2 minutes
            // Clear stuck redirect state
            localStorage.removeItem('authInProgress');
            localStorage.removeItem('redirectStartTime');
            showToast('Sign-in attempt timed out. Please try again.');
        }
    }
}, 30000); // Check every 30 seconds

// Add redirect state cleanup
window.addEventListener('unload', () => {
    if (localStorage.getItem('authInProgress')) {
        localStorage.removeItem('authInProgress');
    }
});

// Event listeners with null checks

// Remove this block since we're handling it in main.js
/*
if (signInButton) {
    signInButton.addEventListener('click', async () => {
        try {
            await signInWithPopup(auth, new GoogleAuthProvider());
            showToast('Signed in successfully');
        } catch (error) {
            console.error("Error signing in: ", error);
            showToast('Failed to sign in');
        }
    });
}
*/

if (signOutButton) {
    signOutButton.addEventListener('click', async () => {
        try {
            await signOut(auth);
            showToast('Signed out successfully');
        } catch (error) {
            console.error("Error signing out: ", error);
            showToast('Failed to sign out');
        }
    });
}

// Update event listeners
document.addEventListener('DOMContentLoaded', () => {
    const googleSignInBtn = document.getElementById('google-signin-btn');
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', async () => {
            try {
                await handleGoogleSignIn();
            } catch (error) {
                // Only log the error, toast is handled in handleGoogleSignIn
                console.error("Google sign in click error:", error);
            }
        });
    }
});

// Initialize connection monitoring
initializeConnectionMonitoring();

// Modal control functions
const showSigninModal = () => {
    const modal = document.getElementById('signin-modal');
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
};

const closeSigninModal = () => {
    const modal = document.getElementById('signin-modal');
    modal.classList.add('hidden');
    modal.setAttribute('inert', '');
    document.getElementById('signin-email').value = '';
    document.getElementById('signin-password').value = '';
};

const handleSignin = async (event) => {
    event.preventDefault();
    event.stopPropagation(); // Prevent event from bubbling up
    const email = document.getElementById('signin-email').value;
    const password = document.getElementById('signin-password').value;
    
    try {
        await signInWithEmail(email, password);
        closeSigninModal();
    } catch (error) {
        console.error('Signin error:', error);
    }
};

// Add signup modal functions
const showSignupModal = () => {
    const modal = document.getElementById('signup-modal');
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
};

const closeSignupModal = () => {
    const modal = document.getElementById('signup-modal');
    modal.classList.add('hidden');
    modal.setAttribute('inert', '');
    document.getElementById('signup-email').value = '';
    document.getElementById('signup-password').value = '';
    document.getElementById('signup-name').value = '';
};

const handleSignup = async (event) => {
    event.preventDefault();
    event.stopPropagation(); // Prevent event from bubbling up
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const name = document.getElementById('signup-name').value;
    
    try {
        await signUpWithEmail(email, password, name);
        closeSignupModal();
    } catch (error) {
        console.error('Signup error:', error);
        // Error toast is already shown in signUpWithEmail
    }
};

// Single export statement for all functions
export { 
    auth, 
    db, 
    syncBookmarks, 
    loadBookmarks,
    signUpWithEmail,
    signInWithEmail,
    showSigninModal,
    closeSigninModal,
    handleSignin,
    handleGoogleSignIn,
    showSignupModal,
    closeSignupModal,
    handleSignup,
    handlePasswordReset
};
