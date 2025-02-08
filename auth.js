import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { 
    getAuth, 
    signInWithPopup, 
    GoogleAuthProvider, 
    signOut,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updateProfile // Add this import
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js';
import { showToast } from './utils.js';

// Add offline detection
let isOffline = false;

// Update connection monitoring
function initializeConnectionMonitoring() {
    try {
        const connectedRef = ref(rtdb, '.info/connected');
        onValue(connectedRef, (snap) => {
            isOffline = !snap.val();
            updateConnectionStatus();
        });
    } catch (error) {
        console.log('Connection monitoring error:', error);
        // Set up fallback offline detection
        window.addEventListener('online', () => {
            isOffline = false;
            updateConnectionStatus();
        });
        window.addEventListener('offline', () => {
            isOffline = true;
            updateConnectionStatus();
        });
    }
}

function updateConnectionStatus() {
    const statusElement = document.getElementById('online-status');
    if (statusElement) {
        if (isOffline) {
            statusElement.innerHTML = `
                <span class="w-3 h-3 bg-red-500 rounded-full mr-2"></span>
                <span class="text-gray-700 font-medium">Offline</span>
            `;
            showToast('Working offline');
        } else {
            statusElement.innerHTML = `
                <span class="w-3 h-3 bg-green-500 rounded-full mr-2 animate-pulse"></span>
                <span class="text-gray-700 font-medium">Online</span>
            `;
            showToast('Back online');
        }
    }
}

const firebaseConfig = {
  apiKey: "AIzaSyCz7CE73lGtT0WweoXuBYxGX58hKAXEK8o",
  authDomain: "ihafeziquran.firebaseapp.com",
  projectId: "ihafeziquran",
  storageBucket: "ihafeziquran.firebasestorage.app",
  messagingSenderId: "961267141827",
  appId: "1:961267141827:web:9cdbaa6cc2aaf1ffad6676"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app); // Add realtime database
const provider = new GoogleAuthProvider();

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
        await setDoc(doc(db, "bookmarks", userId), { bookmarks });
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

// Add Google sign-in handler
const handleGoogleSignIn = async () => {
    try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({
            prompt: 'select_account'
        });
        const result = await signInWithPopup(auth, provider);
        showToast('Signed in successfully with Google');
        return result.user;
    } catch (error) {
        console.error("Google sign in error:", error);
        showToast(error.message);
        throw error;
    }
};

// Auth state observer
auth.onAuthStateChanged(async (user) => {
    if (user) {
        // User is signed in
        userSection.classList.remove('hidden');
        guestSection.classList.add('hidden');
        userAvatar.textContent = user.displayName ? user.displayName[0].toUpperCase() : user.email[0].toUpperCase();
        userDisplayName.textContent = user.displayName || 'Qari'; // Changed 'User' to 'Qari'
        userEmail.textContent = user.email;

        try {
            const userBookmarks = await loadBookmarks(user.uid);
            // Check if updateBookmarkList exists before calling
            if (typeof window.updateBookmarkList === 'function') {
                window.bookmarks = userBookmarks;
                window.updateBookmarkList();
            } else {
                console.log('updateBookmarkList not ready yet');
            }
        } catch (error) {
            console.error('Error in auth state change:', error);
        }
    } else {
        // User is signed out
        userSection.classList.add('hidden');
        guestSection.classList.remove('hidden');
    }
});

// Event listeners with null checks
if (signInButton) {
    signInButton.addEventListener('click', async () => {
        try {
            const result = await signInWithPopup(auth, provider);
            showToast('Signed in successfully');
        } catch (error) {
            console.error("Error signing in: ", error);
            showToast('Failed to sign in');
        }
    });
}

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
    handleSignup
};
