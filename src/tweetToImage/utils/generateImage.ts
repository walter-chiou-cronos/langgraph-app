import { GoogleGenAI, type GenerateImagesConfig } from "@google/genai";

const googleGenAI = new GoogleGenAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

type GeneratedImageData = { mimeType: string; imageBytes: string };

export const generateImagen3Image = async (
  prompt: string,
  config: GenerateImagesConfig = {}
) => {
  const response = await googleGenAI.models.generateImages({
    model: "imagen-3.0-generate-002",
    prompt,
    config: {
      numberOfImages: 1,
      ...config,
    },
  });

  const images: GeneratedImageData[] = [];

  if (!response.generatedImages) {
    return images;
  }

  for (const generatedImage of response.generatedImages) {
    if (generatedImage.image?.imageBytes) {
      const { mimeType, imageBytes } = generatedImage.image;
      if (mimeType) {
        images.push({
          mimeType,
          imageBytes,
        });
      }
    }
  }

  return images;
};

export const generateGemini2Image = async (contents: string[]) => {
  // Set responseModalities to include "Image" so the model can generate an image
  const response = await googleGenAI.models.generateContent({
    model: "gemini-2.0-flash-exp-image-generation",
    contents: contents,
    config: {
      responseModalities: ["Text", "Image"],
    },
  });
  const images: GeneratedImageData[] = [];
  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.text) {
        continue;
      } else if (part.inlineData) {
        const imageBytes = part.inlineData.data;
        const mimeType = part.inlineData.mimeType;

        if (imageBytes && mimeType) {
          images.push({
            mimeType,
            imageBytes,
          });
        }
      }
    }
  }

  return images;
};
