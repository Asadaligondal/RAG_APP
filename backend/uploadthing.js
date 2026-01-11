const { createUploadthing } = require("uploadthing/server");

const f = createUploadthing();

// FileRouter for your app
const uploadRouter = {
  // PDF uploader endpoint
  pdfUploader: f({
    pdf: {
      maxFileSize: "32MB",
      maxFileCount: 5,
    },
  })
    .middleware(async ({ req }) => {
      // Optional: Add authentication here
      // For now, we'll allow all uploads
      return { uploadedBy: "user" };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      console.log("Upload complete!");
      console.log("File URL:", file.url);
      console.log("File name:", file.name);
      console.log("Metadata:", metadata);

      // Return data that will be sent to the client
      return { 
        url: file.url,
        name: file.name,
        size: file.size,
        uploadedBy: metadata.uploadedBy 
      };
    }),
};

module.exports = { uploadRouter };
