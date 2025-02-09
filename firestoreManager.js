import { doc, setDoc, getDoc, collection, addDoc, getDocs, deleteDoc } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { db } from './firebaseConfig.js';

// First, ensure user's document exists
const ensureUserDoc = async (userId) => {
    if (!userId) return false;
    try {
        const userRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) {
            await setDoc(userRef, {
                createdAt: new Date().toISOString(),
                lastRead: 1
            });
        }
        return true;
    } catch (error) {
        console.error('Error ensuring user document:', error);
        return false;
    }
};

// Add a bookmark
export const addBookmark = async (userId, name, page) => {
    try {
        await ensureUserDoc(userId);
        const bookmarksRef = collection(db, 'users', userId, 'bookmarks');
        const docRef = await addDoc(bookmarksRef, {
            name,
            page,
            createdAt: new Date().toISOString()
        });
        return docRef.id;
    } catch (error) {
        console.error("Error adding bookmark:", error);
        return false;
    }
};

// Get all bookmarks
export const getBookmarks = async (userId) => {
    console.log('[Firestore] Getting bookmarks for user:', userId); // Debug log
    
    if (!userId) {
        const localBookmarks = JSON.parse(localStorage.getItem('bookmarks') || '{}');
        console.log('[Firestore] No userId, returning local bookmarks:', localBookmarks);
        return localBookmarks;
    }

    try {
        await ensureUserDoc(userId);
        console.log('[Firestore] User doc ensured'); // Debug log
        
        const bookmarksRef = collection(db, 'users', userId, 'bookmarks');
        console.log('[Firestore] Getting bookmarks from collection:', bookmarksRef.path); // Debug log
        
        const querySnapshot = await getDocs(bookmarksRef);
        console.log('[Firestore] Got querySnapshot, size:', querySnapshot.size); // Debug log
        
        const bookmarks = {};
        
        querySnapshot.forEach(doc => {
            const data = doc.data();
            console.log('[Firestore] Processing bookmark:', { id: doc.id, data }); // Debug log
            bookmarks[data.page] = {
                name: data.name,
                id: doc.id,
                page: data.page
            };
        });
        
        console.log('[Firestore] Final bookmarks object:', bookmarks); // Debug log
        
        // Update local storage and global state
        localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
        if (typeof window !== 'undefined') {
            window.bookmarks = bookmarks;
            console.log('[Firestore] Updated window.bookmarks:', window.bookmarks); // Debug log
        }
        
        return bookmarks;
    } catch (error) {
        console.error('[Firestore] Error getting bookmarks:', error);
        const cached = localStorage.getItem('bookmarks');
        const parsedCache = cached ? JSON.parse(cached) : {};
        console.log('[Firestore] Returning cached bookmarks:', parsedCache); // Debug log
        return parsedCache;
    }
};

// Update bookmark syncing
export const syncBookmarks = async (userId, bookmarks) => {
    if (!userId) {
        localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
        return;
    }

    try {
        await ensureUserDoc(userId);
        // First, delete all existing bookmarks
        const bookmarksRef = collection(db, 'users', userId, 'bookmarks');
        const querySnapshot = await getDocs(bookmarksRef);
        await Promise.all(querySnapshot.docs.map(doc => deleteDoc(doc.ref)));

        // Then add all current bookmarks
        await Promise.all(
            Object.entries(bookmarks).map(([page, data]) => 
                addBookmark(userId, data.name, parseInt(page, 10))
            )
        );

        localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
    } catch (error) {
        console.error("Error syncing bookmarks:", error);
        // Still save to localStorage even if sync fails
        localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
    }
};

// Update last read page
export const updateLastRead = async (userId, pageNum) => {
    if (!userId) return false;
    
    try {
        await ensureUserDoc(userId);
        const userRef = doc(db, 'users', userId);
        await setDoc(userRef, { 
            lastRead: pageNum,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        
        return true;
    } catch (error) {
        console.error("Error updating last page:", error);
        return false;
    }
};

// Update the getLastRead function
export const getLastRead = async (userId) => {
    if (!userId) return null;
    
    try {
        await ensureUserDoc(userId);
        const userRef = doc(db, 'users', userId);
        const docSnap = await getDoc(userRef);
        // Get lastRead from the user document directly
        return docSnap.exists() ? docSnap.data().lastRead || 1 : 1;
    } catch (error) {
        console.error("Error getting last page:", error);
        return 1; // Return 1 as default page
    }
};

// Add this new function to delete a bookmark
export const deleteBookmark = async (userId, bookmarkId) => {
    try {
        await ensureUserDoc(userId);
        const bookmarkRef = doc(db, 'users', userId, 'bookmarks', bookmarkId);
        await deleteDoc(bookmarkRef);
        return true;
    } catch (error) {
        console.error("Error deleting bookmark:", error);
        return false;
    }
};
