import { GoogleGenAI } from "@google/genai";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please set process.env.API_KEY.");
  }
  return new GoogleGenAI({ apiKey });
};

// Helper to remove data:image/...;base64, prefix
const cleanBase64 = (dataUrl: string) => {
  return dataUrl.split(',')[1];
};

export const generateImageFromText = async (prompt: string): Promise<string> => {
  const ai = getAiClient();
  
  // Using gemini-2.5-flash-image for generation as per guidelines for general tasks
  const model = 'gemini-2.5-flash-image'; 

  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [{ text: `Generate an isolated object on a white background: ${prompt}` }]
      }
    });

    // Check for inlineData (image)
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData && part.inlineData.data) {
        return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
      }
    }
    
    throw new Error("No image generated from text.");
  } catch (error) {
    console.error("Error generating image from text:", error);
    throw error;
  }
};

export const placeObjectInImage = async (
  baseImage: string,
  maskImage: string,
  objectImage: string,
  modelName: string = 'gemini-3-pro-image-preview'
): Promise<string> => {
  const ai = getAiClient();
  const model = modelName;

  const prompt = `
    Role: Precision Image Editor.
    
    INPUTS:
    1. Base Image (Target scene).
    2. Mask Image (Strict alignment guide. White = Edit Area, Black = Protected).
    3. Object Image (Source item to insert).

    TASK:
    Insert the Object Image into the Base Image EXACTLY within the White area of the Mask Image.

    MANDATORY RULES:
    1. **COORDINATE ACCURACY**: The Mask Image is perfectly aligned (1:1) with the Base Image. You MUST use the exact pixels defined by the White area of the Mask as the placement target.
    2. **NO OFFSET**: Do not center the object in the image unless the mask is in the center. Do not shift the position. If the mask is in the top-left, the object MUST be in the top-left.
    3. **ASPECT RATIO**: You MUST maintain the original aspect ratio of the Object Image. Do not stretch or squash it. Scale it uniformly to fit inside the White mask shape.
    4. **FITTING**: Scale the object as large as possible to fit within the mask while respecting the aspect ratio.
    5. **INTEGRATION**: Blend the object into the scene (shadows, lighting) but strictly constrain all edits to the White mask pixels.
    6. **PROTECTION**: The Black area of the mask MUST remain pixel-identical to the Base Image.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'image/png',
              data: cleanBase64(baseImage)
            }
          },
          {
            inlineData: {
              mimeType: 'image/png',
              data: cleanBase64(maskImage)
            }
          },
          {
            inlineData: {
              mimeType: 'image/png', // Assuming png/jpeg
              data: cleanBase64(objectImage)
            }
          }
        ]
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData && part.inlineData.data) {
        return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
      }
    }

    throw new Error("No image returned from placement operation.");

  } catch (error) {
    console.error("Error placing object:", error);
    throw error;
  }
};

export const eraseObjectInImage = async (
  baseImage: string,
  maskImage: string,
  modelName: string = 'gemini-3-pro-image-preview'
): Promise<string> => {
  const ai = getAiClient();
  const model = modelName;

  const prompt = `
    Task: Object Removal and Inpainting.
    
    Inputs:
    1. Base Image.
    2. Mask Image (White = Area to remove/inpaint).

    Instructions:
    1. Remove content in the White area.
    2. Inpaint the area to match the surrounding background naturally.
    3. Strictly respect the mask boundaries.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'image/png',
              data: cleanBase64(baseImage)
            }
          },
          {
            inlineData: {
              mimeType: 'image/png',
              data: cleanBase64(maskImage)
            }
          }
        ]
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData && part.inlineData.data) {
        return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
      }
    }

    throw new Error("No image returned from erase operation.");

  } catch (error) {
    console.error("Error erasing object:", error);
    throw error;
  }
};