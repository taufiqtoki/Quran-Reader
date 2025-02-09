import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { initializeFirestore } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js';

export const firebaseConfig = {
    apiKey: "AIzaSyCz7CE73lGtT0WweoXuBYxGX58hKAXEK8o",
    authDomain: "ihafeziquran.firebaseapp.com",
    projectId: "ihafeziquran",
    databaseURL: "https://ihafeziquran-default-rtdb.firebaseio.com",
    storageBucket: "ihafeziquran.firebasestorage.app",
    messagingSenderId: "961267141827",
    appId: "1:961267141827:web:9cdbaa6cc2aaf1ffad6676"
};

// Initialize Firebase
const app = window.firebaseApp || initializeApp(firebaseConfig);

// Initialize services
const auth = getAuth(app);
const db = initializeFirestore(app, {
    cacheSizeBytes: 50 * 1024 * 1024,
    experimentalForceLongPolling: true,
    useFetchStreams: false
});
const rtdb = getDatabase(app);

export { app, auth, db, rtdb };
