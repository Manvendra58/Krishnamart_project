// Firebase configuration (provided by you)
const firebaseConfig = {
  apiKey: "AIzaSyBhQ1WKBdmT7SEjxDa9vhajEsD0W1A1uAg",
  authDomain: "krishnamart-42b3b.firebaseapp.com",
  projectId: "krishnamart-42b3b",
  storageBucket: "krishnamart-42b3b.appspot.com",
  messagingSenderId: "1051296210628",
  appId: "1:1051296210628:web:53a7c714f2874f3ed97391"
};

// Using compat SDKs loaded in login.html
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Expose auth instance globally
window.firebaseAuth = firebase.auth();


