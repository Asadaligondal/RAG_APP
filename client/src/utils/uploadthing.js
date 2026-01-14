import { generateReactHelpers } from "@uploadthing/react";

// make sure this line is exactly here
const baseUrl = process.env.REACT_APP_API_URL || "http://localhost:5000";

export const { useUploadThing, uploadFiles } =
  generateReactHelpers({
    url: `${baseUrl}/api/uploadthing`,
  });