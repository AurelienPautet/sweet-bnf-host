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
    description: 'Retrieve OCR or TEI text for a specific page when available. Returns null if text is not available.',
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
 * Get page OCR tool using Tesseract.js
 */
export function createGetPageOcrTool(iiifClient: IIIFClient) {
  return {
    name: 'get_page_ocr',
    description: 'Perform OCR (text recognition) on a document page using Tesseract.js when the raw text is not available. Returns the extracted text.',
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
          description: 'OCR language code (e.g., "fra" for French, "eng" for English). Default: "fra"',
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
      
      try {
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker(lang);
        const { data: { text } } = await worker.recognize(imageUrl);
        await worker.terminate();
        
        return {
          ark: parsed.ark,
          page: parsed.page,
          lang,
          text,
          length: text.length
        };
      } catch (error) {
        throw new Error(`OCR processing failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

