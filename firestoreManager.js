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
    if (!userId) {
        return JSON.parse(localStorage.getItem('bookmarks') || '{}');
    }

    try {
        await ensureUserDoc(userId);
        const bookmarksRef = collection(db, 'users', userId, 'bookmarks');
        const querySnapshot = await getDocs(bookmarksRef);
        
        const bookmarks = {};
        querySnapshot.forEach(doc => {
            const data = doc.data();
            bookmarks[data.page] = {
                name: data.name,
                id: doc.id,
                page: data.page
            };
        });
        
        localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
        if (typeof window !== 'undefined') {
            window.bookmarks = bookmarks;
        }
        
        return bookmarks;
    } catch (error) {
        return JSON.parse(localStorage.getItem('bookmarks') || '{}');
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
        const userRef = doc(db, 'users', userId);
        // Store as number, not string
        const pageNumber = parseInt(pageNum, 10);
        await setDoc(userRef, { 
            lastRead: pageNumber,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        
        return true;
    } catch (error) {
        console.error("Error updating last page:", error);
        throw error; // Let the caller handle the error
    }
};

// Update the getLastRead function
export const getLastRead = async (userId) => {
    if (!userId) return null;
    
    try {
        const userRef = doc(db, 'users', userId);
        const docSnap = await getDoc(userRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            // Important: Convert to number and ensure it's valid
            const lastReadPage = parseInt(data.lastRead || data.lastpage, 10);
            console.log('[Firestore] Got last read page:', lastReadPage);
            return lastReadPage || 1;
        }
        return 1;
    } catch (error) {
        console.error("Error getting last page:", error);
        return 1;
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
