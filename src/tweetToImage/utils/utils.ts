import * as fs from "node:fs";
import path from "node:path";

export const saveFileToDisk = async (
  filePath: string,
  data: Parameters<typeof fs.writeFileSync>[1]
): Promise<void> => {
  try {
    // Ensure the directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write the buffer to a file
    await fs.promises.writeFile(filePath, data);
    console.info(`Image saved to ${filePath}`);
  } catch (error) {
    console.error(`Failed to save image to ${filePath}:`, error);
  }
};

export const writeImageToDisk = async (
  fileName: string,
  data: Parameters<typeof fs.writeFileSync>[1]
): Promise<void> => {
  const filePath = path.join(__dirname, "../../../temp", `${fileName}`);

  return saveFileToDisk(filePath, data);
};
