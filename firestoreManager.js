import { doc, setDoc, getDoc, collection, addDoc, getDocs, deleteDoc, query, where, updateDoc, runTransaction } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
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
    if (!userId) throw new Error('User ID is required');
    
    try {
        await ensureUserDoc(userId);
        const bookmarksRef = collection(db, 'users', userId, 'bookmarks');
        
        // Use transaction to prevent race conditions
        return await runTransaction(db, async (transaction) => {
            // Check for existing bookmark with same name or page
            const nameQuery = query(bookmarksRef, where('name', '==', name));
            const pageQuery = query(bookmarksRef, where('page', '==', page));
            
            const [nameSnapshot, pageSnapshot] = await Promise.all([
                getDocs(nameQuery),
                getDocs(pageQuery)
            ]);
            
            if (!nameSnapshot.empty || !pageSnapshot.empty) {
                // Return existing bookmark ID if found
                const existingDoc = nameSnapshot.docs[0] || pageSnapshot.docs[0];
                return existingDoc.id;
            }

            // Create new bookmark only if no duplicates found
            const newBookmarkRef = doc(bookmarksRef);
            transaction.set(newBookmarkRef, {
                name,
                page,
                createdAt: new Date().toISOString()
            });
            
            return newBookmarkRef.id;
        });
    } catch (error) {
        console.error("Error managing bookmark:", error);
        throw error;
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
    console.log('Deleting bookmark:', { userId, bookmarkId });
    
    if (!userId || !bookmarkId) {
        console.error('Missing required params:', { userId, bookmarkId });
        return false;
    }
    
    try {
        const bookmarksRef = collection(db, 'users', userId, 'bookmarks');
        
        // First check if the bookmark exists
        const bookmarkRef = doc(bookmarksRef, bookmarkId);
        const bookmarkDoc = await getDoc(bookmarkRef);
        
        if (!bookmarkDoc.exists()) {
            console.log('Bookmark not found, searching by page...');
            // If not found by ID, try to find by page
            const page = parseInt(bookmarkId, 10);
            if (!isNaN(page)) {
                const q = query(bookmarksRef, where('page', '==', page));
                const querySnapshot = await getDocs(q);
                await Promise.all(querySnapshot.docs.map(doc => deleteDoc(doc.ref)));
                return true;
            }
            return false;
        }

        await deleteDoc(bookmarkRef);
        console.log('Bookmark deleted successfully');
        return true;
    } catch (error) {
        console.error('Firestore deletion error:', error);
        throw error;
    }
};
