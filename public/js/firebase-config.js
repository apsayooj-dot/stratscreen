// Firebase project config for StratScreen.
// Safe to be public - security comes from Firebase Auth + rules, not from hiding this file.
const firebaseConfig = {
    apiKey: "AIzaSyDhalHP2Sv_a74gOkT9jYVjI1QoMSoCCkw",
    authDomain: "stratscreen.firebaseapp.com",
    projectId: "stratscreen",
    storageBucket: "stratscreen.firebasestorage.app",
    messagingSenderId: "208331595329",
    appId: "1:208331595329:web:7bf0e69f52441314d030c0",
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
