/**
 * MCP tools for item details, pages, images, and text
 * Extended features not in Python version
 */

import { z } from 'zod';
import { ItemsClient } from '../gallica/items.js';
import { IIIFClient } from '../gallica/iiif.js';
import { TextClient } from '../gallica/text.js';

/**
 * Get item details tool
 */
export function createGetItemDetailsTool(itemsClient: ItemsClient) {
  return {
    name: 'get_item_details',
    description: 'Get full metadata for a Gallica item by its ARK identifier. Returns bibliographic data, available formats, and helpful URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        ark: {
          type: 'string',
          description: 'ARK identifier (e.g., "ark:/12148/bpt6k123456" or "bpt6k123456")',
        },
      },
      required: ['ark'],
    },
    handler: async (args: unknown) => {
      const parsed = z.object({ ark: z.string() }).parse(args);
      return await itemsClient.getItemMetadata(parsed.ark);
    },
  };
}

/**
 * Get item pages tool
 */
export function createGetItemPagesTool(itemsClient: ItemsClient) {
  return {
    name: 'get_item_pages',
    description: 'Enumerate pages of a document. Returns logical page numbers, IIIF image URLs, and text availability flags.',
    inputSchema: {
      type: 'object',
      properties: {
        ark: {
          type: 'string',
          description: 'ARK identifier',
        },
        page: {
          type: 'number',
          description: 'Get specific page number',
        },
        page_size: {
          type: 'number',
          description: 'Get first N pages',
        },
        page_range: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description: 'Get pages in range [start, end]',
        },
      },
      required: ['ark'],
    },
    handler: async (args: unknown) => {
      const parsed = z.object({
        ark: z.string(),
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().optional(),
        page_range: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
      }).parse(args);

      const options: {
        page?: number;
        pageSize?: number;
        range?: [number, number];
      } = {};

      if (parsed.page !== undefined) {
        options.page = parsed.page;
      } else if (parsed.page_size !== undefined) {
        options.pageSize = parsed.page_size;
      } else if (parsed.page_range !== undefined) {
        options.range = parsed.page_range;
      }

      return await itemsClient.getItemPages(parsed.ark, options);
    },
  };
}

/**
 * Get page image tool
 */
export function createGetPageImageTool(iiifClient: IIIFClient) {
  return {
    name: 'get_page_image',
    description: 'Get IIIF image URL for a specific page. Returns URL and metadata, not binary data. Note: If you need to read or analyze the text of the page, use get_page_text (if available) or get_page_ocr (if you need to perform OCR on the image).',
    inputSchema: {
      type: 'object',
      properties: {
        ark: {
          type: 'string',
          description: 'ARK identifier',
        },
        page: {
          type: 'number',
          description: 'Page number',
        },
        size: {
          type: 'string',
          description: 'Image size (e.g., "full", "200,", "500,500", "pct:50")',
        },
        region: {
          type: 'string',
          description: 'Image region (e.g., "full", "x,y,w,h")',
        },
      },
      required: ['ark', 'page'],
    },
    handler: async (args: unknown) => {
      const parsed = z.object({
        ark: z.string(),
        page: z.number().int().positive(),
        size: z.string().optional(),
        region: z.string().optional(),
      }).parse(args);

      const options: { size?: string; region?: string } = {};
      if (parsed.size) options.size = parsed.size;
      if (parsed.region) options.region = parsed.region;
      
      const url = iiifClient.getImageUrl(parsed.ark, parsed.page, options);

      return {
        ark: parsed.ark,
        page: parsed.page,
        iiif_url: url,
        thumbnail_url: iiifClient.getImageUrl(parsed.ark, parsed.page, { size: '200,' }),
      };
    },
  };
}

/**
 * Get page text tool
 */
export function createGetPageTextTool(textClient: TextClient) {
  return {
    name: 'get_page_text',
    description: 'Retrieve raw native OCR or TEI text for a specific page when available. WARNING: This native OCR is often of very poor quality and contains many errors. Use get_page_ocr as the primary method for high-quality transcription. Only use get_page_text as a last resort if get_page_ocr fails, has quota issues, or returns suspicious results.',
    inputSchema: {
      type: 'object',
      properties: {
        ark: {
          type: 'string',
          description: 'ARK identifier',
        },
        page: {
          type: 'number',
          description: 'Page number',
        },
        format: {
          type: 'string',
          enum: ['plain', 'alto', 'tei'],
          description: 'Text format (default: plain)',
        },
      },
      required: ['ark', 'page'],
    },
    handler: async (args: unknown) => {
      const parsed = z.object({
        ark: z.string(),
        page: z.number().int().positive(),
        format: z.enum(['plain', 'alto', 'tei']).optional(),
      }).parse(args);

      const text = await textClient.getPageText(parsed.ark, parsed.page, parsed.format || 'plain');

      return {
        ark: parsed.ark,
        page: parsed.page,
        format: parsed.format || 'plain',
        text: text,
        available: text !== null,
      };
    },
  };
}

/**
 * Get page OCR tool (hybrid: Gemini API with Tesseract.js fallback)
 */
export function createGetPageOcrTool(iiifClient: IIIFClient) {
  return {
    name: 'get_page_ocr',
    description: 'Perform OCR (text recognition) on a document page. Uses Google Gemini API if GEMINI_API_KEY is configured (highly accurate), otherwise falls back to local Tesseract.js OCR.',
    inputSchema: {
      type: 'object',
      properties: {
        ark: {
          type: 'string',
          description: 'ARK identifier (e.g., "bpt6k123456")',
        },
        page: {
          type: 'number',
          description: 'Page number',
        },
        lang: {
          type: 'string',
          description: 'OCR language code for local fallback (e.g., "fra" for French, "eng" for English). Default: "fra"',
          default: 'fra',
        },
        size: {
          type: 'string',
          description: 'Resolution of the image to perform OCR on (e.g., "full", "1000,"). Default: "full"',
          default: 'full',
        }
      },
      required: ['ark', 'page'],
    },
    handler: async (args: unknown) => {
      const parsed = z.object({
        ark: z.string(),
        page: z.number().int().positive(),
        lang: z.string().optional(),
        size: z.string().optional(),
      }).parse(args);

      const lang = parsed.lang || 'fra';
      const size = parsed.size || 'full';
      
      const imageUrl = iiifClient.getImageUrl(parsed.ark, parsed.page, { size });
      
      let imageBuffer: Buffer;
      try {
        const response = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Gallica server responded with ${response.status} ${response.statusText}`);
        }
        
        imageBuffer = Buffer.from(await response.arrayBuffer());
      } catch (error) {
        throw new Error(`Failed to download page image from Gallica (URL: ${imageUrl}): ${error instanceof Error ? error.message : String(error)}. Gallica may be rate-limiting requests (HTTP 429) or blocking the server IP.`);
      }

      const geminiApiKey = process.env.GEMINI_API_KEY;
      const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
      
      if (geminiApiKey) {
        try {
          const base64Data = imageBuffer.toString('base64');
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
          
          const payload = {
            contents: [
              {
                parts: [
                  {
                    text: "Tu es un transcripteur professionnel de documents numérisés et historiques. Transcris fidèlement tout le texte visible sur cette page d'une bibliothèque numérique. Conserve les sauts de lignes et la structure générale du texte. Renvoie uniquement le texte transcrit, sans introduction, sans commentaire et sans fioritures."
                  },
                  {
                    inlineData: {
                      mimeType: "image/jpeg",
                      data: base64Data
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.1
            }
          };
          
          const apiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
          
          if (!apiResponse.ok) {
            const errText = await apiResponse.text();
            throw new Error(`Gemini API error (${apiResponse.status}): ${errText}`);
          }
          
          const resJson = await apiResponse.json() as any;
          const candidate = resJson.candidates?.[0];
          
          if (candidate?.finishReason === 'RECITATION') {
            throw new Error(`Gemini API blocked transcription due to 'RECITATION' finishReason (copyright protection filter triggered).`);
          }
          
          const extractedText = candidate?.content?.parts?.[0]?.text;
          
          if (!extractedText) {
            throw new Error("Empty response from Gemini API (no text returned)");
          }
          
          return {
            ark: parsed.ark,
            page: parsed.page,
            method: `gemini-api:${geminiModel}`,
            text: extractedText.trim(),
            length: extractedText.length
          };
        } catch (error) {
          // Log fallback warning and fall through to local OCR
          console.warn(`[OCR] Gemini transcription failed, falling back to local Tesseract.js:`, error instanceof Error ? error.message : error);
        }
      }
      
      // Local Tesseract.js fallback using the already downloaded imageBuffer
      try {
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker(lang);
        try {
          const { data: { text } } = await worker.recognize(imageBuffer);
          return {
            ark: parsed.ark,
            page: parsed.page,
            method: "tesseract-local",
            lang,
            text,
            length: text.length
          };
        } finally {
          await worker.terminate();
        }
      } catch (error) {
        throw new Error(`OCR processing failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

