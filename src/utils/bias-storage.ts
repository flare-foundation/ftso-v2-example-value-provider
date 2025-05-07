import fs from "fs";
import path from "path";

// Immer auf src/config verweisen – unabhängig von dist/
const biasFilePath = path.resolve(__dirname, "../../src/config/bias-cache.json");

export const biases: Record<string, number> = {};

export function getBias(key: string): number {
  return biases[key] ?? 0;
}

export function setBias(key: string, value: number): void {
  biases[key] = value;
}

export async function saveBiases(): Promise<void> {
  const dir = path.dirname(biasFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await fs.promises.writeFile(biasFilePath, JSON.stringify(biases, null, 2));
}

export async function loadBiases(): Promise<void> {
  try {
    if (fs.existsSync(biasFilePath)) {
      const content = await fs.promises.readFile(biasFilePath, "utf8");
      Object.assign(biases, JSON.parse(content));
    }
  } catch (e) {
    console.error("❌ Fehler beim Laden von bias-cache.json:", e);
  }
}
