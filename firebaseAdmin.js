const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('❌ FIREBASE_PROJECT_ID is not defined in .env');
}
console.log('Initializing Firebase Admin with Project ID:', projectId);

admin.initializeApp({
  projectId: projectId,
});


module.exports = admin;
