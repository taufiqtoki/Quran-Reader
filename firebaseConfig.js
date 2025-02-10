import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js';

const firebaseConfig = {
    apiKey: "AIzaSyCz7CE73lGtT0WweoXuBYxGX58hKAXEK8o",
    authDomain: "ihafeziquran.firebaseapp.com",
    projectId: "ihafeziquran",
    databaseURL: "https://ihafeziquran-default-rtdb.asia-southeast1.firebasedatabase.app",
    storageBucket: "ihafeziquran.firebasestorage.app",
    messagingSenderId: "961267141827",
    appId: "1:961267141827:web:9cdbaa6cc2aaf1ffad6676"
};

// Initialize Firebase once
const app = initializeApp(firebaseConfig);

// Get service instances
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

export { app, auth, db, rtdb };
