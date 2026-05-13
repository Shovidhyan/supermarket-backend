const multer = require('multer');

// Configure storage to keep files in memory (Buffer)
const storage = multer.memoryStorage();

// File Filter (Images Only)
const fileFilter = (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp/;
    const mimetype = filetypes.test(file.mimetype);
    
    // Check extension using path is not needed for buffer, 
    // but checking mimetype is safer.
    if (mimetype) {
        return cb(null, true);
    }
    cb(new Error('Error: Images Only!'));
};

const memoryUpload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit (Database space is expensive)
    fileFilter: fileFilter
});

module.exports = memoryUpload;