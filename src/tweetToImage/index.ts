import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { PromptTemplate } from "@langchain/core/prompts";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";

import dedent from "dedent";
import { z } from "zod";
import { generateImagen3Image } from "./utils/generateImage";

const geminiLLM = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash-exp-image-generation",
  maxRetries: 0,
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const openaiLLM = new ChatOpenAI({
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
});

export const ART_STYLE = {
  NONE: "NONE",
  SURREALISM: "Surrealism",
  CARTOON: "Cartoon",
  ANIME: "Anime",
  FUTURISTIC: "Futuristic",
  PHOTO_REALISTIC: "Photorealistic",
} as const;

// Graph state
const StateAnnotation = Annotation.Root({
  tweet: Annotation<string>,
  aspectRatio: Annotation<string>,
  artStyle: Annotation<string>({
    default: () => "NONE",
    reducer: (a, b) => b,
  }),
  prompt: Annotation<string>,
  rating: Annotation<number>,
  ratingExplanation: Annotation<string>,
  images: Annotation<{ image: string; mimeType: string }[]>,
  shouldRemoveBranding: Annotation<boolean>({
    default: () => true,
    reducer: (a, b) => b,
  }),
});

const prepareContentForImageGenerationPromptTemplate =
  PromptTemplate.fromTemplate(
    dedent`
      # Role: Content Rewriter for Image Generation

      You are an expert in analyzing and rewriting social media text, particularly tweets, to prepare them for image generation workflows. Your task is to identify specific real-world entities (e.g., brands, logos, trademarks, individuals) in the tweet content and replace them with generic, contextually relevant descriptions that are visually interpretable by an image generation model. Ensure the rewritten content maintains the original meaning, intent, and tone of the tweet.

      # Instructions:
      - Identify specific entities (e.g., brands, logos, trademarks, individuals).
      - Replace them with generic descriptions that are visually interpretable by an image generation model.
      - Preserve the meaning and intent of the tweet.
      - Remove all hashtags while keeping the core message intact.
      - Do not modify generic terms already present in the tweet.

      # Tweet Content:
      {tweet}

      # Examples:
      - Input: "Just bought some new Nike sneakers! They look amazing. #Nike"
        Output: "Just bought some new athletic sneakers! They look amazing."
      - Input: "Excited for the new iPhone release! Can't wait to see the camera improvements. #Apple"
        Output: "Excited for the new smartphone release! Can't wait to see the camera improvements."
      - Input: "Is Bitcoin going to surge again? What are your thoughts? #Bitcoin"
        Output: "Is a major cryptocurrency going to surge again? What are your thoughts."

      # Output Format:
      - Provide the rewritten tweet as a single string.
      - Do not include any additional text or explanation.
  `
  );

const removeBranding = async (state: typeof StateAnnotation.State) => {
  const prompt = await prepareContentForImageGenerationPromptTemplate.format({
    tweet: state.tweet,
  });
  const msg = await openaiLLM.invoke(prompt);

  return { tweet: msg.content };
};

const generateImagePromptTemplate = PromptTemplate.fromTemplate(
  dedent`
    # Role: Image Prompt Generator
    You are an AI tasked with generating a concise initial image prompt based on the content of a tweet.

    # TWEET CONTENT:
    {tweet}

    # TASK:
    Analyze the tweet and generate a concise image prompt capturing its essence.

    # INSTRUCTIONS:
    - Identify the key subject, context, and potential visual style from the tweet.
    - Use descriptive keywords for the subject, context, lighting, and colors.
    - Consider the overall mood or emotion conveyed.
    
    # NEGATIVE PROMPT:
    {negativePrompt}

    # OUTPUT PROMPT TEMPLATE:
    Generate a [image medium] [artistic style] [subject] in a [context/background], with [lighting] and [colors] colors. [Optional: Specific details related to the tweet]. [Optional: Image quality modifiers].

    # VARIABLE DESCRIPTIONS:
    - [image medium]:  e.g., image, photo, painting, illustration, 3d render
    - [artistic style]: e.g., anime, cartoon, realistic, abstract, impressionist, cyberpunk
    - [subject]: main object/concept
    - [context/background]: environment or surrounding
    - [lighting]: e.g., bright, dim, neon
    - [colors]: e.g., vibrant, muted, monochrome
    - [Optional: Specific details related to the tweet]: Details directly derived from the tweet content.
    - [Optional: Image quality modifiers]: e.g., high detail, beautiful

    # OUTPUT FORMAT:
    - Provide only the single-sentence image prompt.
    - Do not include any additional text or explanation.
`
);

const generateImagePrompt = async (state: typeof StateAnnotation.State) => {
  const prompt = await generateImagePromptTemplate.format({
    tweet: state.tweet,
    negativePrompt: state.shouldRemoveBranding
      ? dedent`
        # NEGATIVE PROMPT
        - Logo, Icon, Brand
      `
      : "",
  });
  const msg = await geminiLLM.invoke(prompt);
  return { prompt: msg.content };
};

const applyArtStyleToImagePromptTemplate = PromptTemplate.fromTemplate(
  dedent`
    # Role:
    Art Style Enhancer for Image Prompts.
    You are an art expert tasked with enhancing a basic image prompt by applying a specific artistic style and adding relevant visual details.

    # Artistic style:
    {artStyle}

    # Input Image Prompt:
    {prompt}

    # Instructions:
    Refine the provided image prompt by incorporating the specified art style and adding relevant visual details. Focus on enhancing the image medium, subject, context, lighting, and colors to align with the art style.

    # ENHANCED IMAGE PROMPT TEMPLATE:
    Generate a [image medium] {artStyle} (artistic style) [subject from prompt] in a [context/background from prompt], with [lighting adjusted for style] and [colors aligned with style]. [Optional: Specific details enhanced by the art style, e.g., brushstrokes, textures, specific character design]. [Optional: Image quality modifiers relevant to the style, e.g., cel-shaded, photorealistic].

    # VARIABLE DESCRIPTIONS:
    - [image medium]: The base image creation method (e.g., image, photo, painting).
    - [artistic style: {artStyle}]: The specific artistic style to apply (e.g., anime, cartoon, realistic). This will be replaced with the value of the {artStyle} variable.
    - [subject from prompt]: The main subject extracted from the initial prompt.
    - [context/background from prompt]: The environment extracted from the initial prompt.
    - [lighting adjusted for style]: Lighting conditions that are characteristic of the {artStyle}.
    - [colors aligned with style]: A color scheme that is typical of the {artStyle}.
    - [Optional: Specific details enhanced by the art style]: Visual elements and characteristics unique to the chosen art style.
    - [Optional: Image quality modifiers]: Keywords relevant to the quality and rendering style of the {artStyle}.

    # OUTPUT FORMAT:
    - Provide only the single-sentence enhanced image prompt.
    - Do not include any additional text or explanation.
`
);

const applyArtStyleToImagePrompt = async (
  state: typeof StateAnnotation.State
) => {
  const prompt = await applyArtStyleToImagePromptTemplate.format({
    artStyle: state.artStyle,
    prompt: state.prompt,
  });
  const msg = await geminiLLM.invoke(prompt);

  console.log({
    originalPrompt: state.prompt,
    newPrompt: msg.content,
  });
  return { prompt: msg.content };
};

const rateImageSuitabilityForTweetTemplate = PromptTemplate.fromTemplate(
  dedent`
    # TASK: RATE AND PROVIDE A REASON FOR HOW NECESSARY IT IS TO GENERATE AN IMAGE FOR THE [TWEET CONTENT] BELOW BASED ON [CRITERIA FOR GENERATING AN IMAGE] AND THE FOLLOWING [RATING SCALE]

    # TWEET CONTENT
    {tweet}

    # FACTORS TO CONSIDER
    - **Relevance**: How directly relevant is an image to the tweet's content?
    - **Engagement**: Will an image significantly increase engagement (e.g., likes, shares, comments)?
    - **Clarity**: Does an image help explain or enhance the tweet's message?
    - **Context**: Is the tweet part of a visual campaign or theme?
    - **Originality**: Does the tweet contain unique or creative content that benefits from an image?

    # RATING SCALE  
    - 1: Not suitable at all (e.g., The tweet is purely text-based and does not describe anything visual)
    - 2-3: Slightly suitable, but not necessary (e.g., An image could be added, but it does not add significant value)
    - 4-5: Moderately suitable, could go either way (e.g., An image might enhance the tweet, but it is not crucial)
    - 6-7: Suitable, an image would be beneficial (e.g., An image would make the tweet more engaging and clear)
    - 8-9: Very suitable, an image would significantly enhance the tweet (e.g., An image is highly relevant and adds substantial value)
    - 10: Highly suitable, an image is essential for the tweet (e.g., The tweet's message relies heavily on visual representation)

    # INSTRUCTIONS: RATE IF YOU THINK WE SHOULD GENERATE AN IMAGE FOR THIS TWEET ON A SCALE OF 1 TO 10, AND PROVIDE THE REASON.
    - The "rating" field should be a number between 1 and 10.
    - The "ratingExplanation" field should be a string describing why the rating is given.
`
);

const rateImageSuitabilityForTweetSchema = z.object({
  rating: z.number().describe("A number between 1 and 10"),
  ratingExplanation: z.string().describe("A string explaining the rating"),
});

const rateImageLlmWithStructuredOutput = openaiLLM.withStructuredOutput(
  rateImageSuitabilityForTweetSchema,
  {
    name: "rateImageSuitability",
  }
);

const rateImageSuitability = async (state: typeof StateAnnotation.State) => {
  const prompt = await rateImageSuitabilityForTweetTemplate.format({
    tweet: state.tweet,
  });

  const { rating, ratingExplanation } =
    await rateImageLlmWithStructuredOutput.invoke(prompt, {});

  return { rating, ratingExplanation };
};

const generateImageFromPrompt = async (state: typeof StateAnnotation.State) => {
  try {
    const { aspectRatio } = state;

    const images = await generateImagen3Image(state.prompt, {
      ...(aspectRatio && { aspectRatio }),
    });

    return {
      images: images.map((image) => ({
        image: image.imageBytes,
        mimeType: image.mimeType,
      })),
    };
  } catch (e) {
    console.error("Error calling generateImageFromPrompt", e);
    return {
      images: [],
    };
  }
};

const canGenerateImage = (state: typeof StateAnnotation.State) =>
  !!state.rating && state.rating > 5 ? "YES" : "NO";

const shouldRemoveBranding = (state: typeof StateAnnotation.State) =>
  state.shouldRemoveBranding ? "YES" : "NO";

// Build graph
export const tweetToImageGraph = new StateGraph(StateAnnotation)
  .addNode("checkShouldRemoveBranding", (state) => state) // placeholder node
  .addNode("removeBranding", removeBranding)
  .addNode("rateImageSuitability", rateImageSuitability)
  .addNode("checkCanGenerateImage", (state) => state) // placeholder node
  .addNode("generateImagePrompt", generateImagePrompt)
  .addNode("applyArtStyleToImagePrompt", applyArtStyleToImagePrompt)
  .addNode("generateImageFromPrompt", generateImageFromPrompt)
  .addEdge(START, "checkShouldRemoveBranding")
  .addConditionalEdges("checkShouldRemoveBranding", shouldRemoveBranding, {
    YES: "removeBranding",
    NO: "rateImageSuitability",
  })
  .addEdge("removeBranding", "rateImageSuitability")
  .addEdge("rateImageSuitability", "checkCanGenerateImage")
  .addConditionalEdges("checkCanGenerateImage", canGenerateImage, {
    YES: "generateImagePrompt",
    NO: END,
  })
  .addEdge("generateImagePrompt", "applyArtStyleToImagePrompt")
  .addEdge("applyArtStyleToImagePrompt", "generateImageFromPrompt")
  .addEdge("generateImageFromPrompt", END)
  .compile();
