export enum ToolType {
  BRUSH = 'BRUSH',
  HAND = 'HAND',
}

export interface Point {
  x: number;
  y: number;
}

export interface Transform {
  x: number;
  y: number;
  k: number; // Scale factor
}

export enum AppState {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPARING = 'COMPARING',
}

export interface ObjectSource {
  type: 'image' | 'text';
  data: string; // Base64 for image, text string for prompt
  previewUrl?: string; // For text-generated or uploaded image
}
