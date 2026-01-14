import { generateReactHelpers } from "@uploadthing/react";

// 1. Get the base URL from the environment variable we just set on Vercel
// 2. If it's missing (like on your laptop), fallback to localhost:5000
const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export const { useUploadThing, uploadFiles } =
  generateReactHelpers({
    // Dynamically set the full URL
    url: `${baseUrl}/api/uploadthing`,
  });