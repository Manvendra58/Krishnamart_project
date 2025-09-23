const admin = require('firebase-admin');

let initialized = false;

function initFirebaseAdmin() {
    if (initialized) return admin;

    // Prefer GOOGLE_APPLICATION_CREDENTIALS, fallback to FIREBASE_SERVICE_ACCOUNT JSON in env
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!admin.apps.length) {
        if (serviceAccountJson) {
            const serviceAccount = JSON.parse(serviceAccountJson);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        } else {
            admin.initializeApp();
        }
    }

    initialized = true;
    return admin;
}

module.exports = { initFirebaseAdmin };




