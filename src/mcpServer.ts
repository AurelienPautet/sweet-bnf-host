/**
 * MCP Server initialization and tool registration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { GallicaAPI } from './gallica/api.js';
import { IIIFClient } from './gallica/iiif.js';
import { TextClient } from './gallica/text.js';
import { ItemsClient } from './gallica/items.js';
import { SequentialReportingServer } from './gallica/sequential_reporting.js';
import { config } from './config.js';
import { logger } from './logging.js';

// Search tools
import {
  createSearchByTitleTool,
  createSearchByAuthorTool,
  createSearchBySubjectTool,
  createSearchByDateTool,
  createSearchByDocumentTypeTool,
  createAdvancedSearchTool,
  createNaturalLanguageSearchTool,
} from './tools/gallicaSearch.js';

// Item tools
import {
  createGetItemDetailsTool,
  createGetItemPagesTool,
  createGetPageImageTool,
  createGetPageTextTool,
  createGetPageOcrTool,
} from './tools/items.js';

// Report tool
import { createSequentialReportingTool } from './tools/reports.js';

/**
 * Initialize and configure MCP server
 */
/**
 * Get the icon URL for the server
 * Uses MCP_ICON_URL env var if set, otherwise returns relative path
 */
function getIconUrl(): string | undefined {
  if (config.iconUrl) {
    return config.iconUrl;
  }
  // Return relative path - client will resolve it based on server URL
  return '/icon.svg';
}

export async function createMCPServer(): Promise<Server> {
  const server = new Server(
    {
      name: 'gallica-bnf-api',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Initialize API clients
  const gallicaApi = new GallicaAPI();
  const searchApi = gallicaApi.searchAPI;
  const httpClient = gallicaApi.getHttpClient();
  const iiifClient = new IIIFClient(httpClient, config.gallicaBaseUrl);
  const textClient = new TextClient(httpClient, config.gallicaBaseUrl);
  const itemsClient = new ItemsClient(httpClient, iiifClient, config.gallicaBaseUrl);
  const reportingServer = new SequentialReportingServer(gallicaApi, searchApi);

  // Register search tools (7 tools matching Python)
  const searchByTitle = createSearchByTitleTool(searchApi);
  const searchByAuthor = createSearchByAuthorTool(searchApi);
  const searchBySubject = createSearchBySubjectTool(searchApi);
  const searchByDate = createSearchByDateTool(searchApi);
  const searchByDocumentType = createSearchByDocumentTypeTool(searchApi);
  const advancedSearch = createAdvancedSearchTool(searchApi);
  const naturalLanguageSearch = createNaturalLanguageSearchTool(searchApi);

  // Register extended item tools (5 tools)
  const getItemDetails = createGetItemDetailsTool(itemsClient);
  const getItemPages = createGetItemPagesTool(itemsClient);
  const getPageImage = createGetPageImageTool(iiifClient);
  const getPageText = createGetPageTextTool(textClient);
  const getPageOcr = createGetPageOcrTool(iiifClient);

  // Register sequential reporting tool
  const sequentialReporting = createSequentialReportingTool(reportingServer);

  // Register all tools with error handling
  const tools = [
    searchByTitle,
    searchByAuthor,
    searchBySubject,
    searchByDate,
    searchByDocumentType,
    advancedSearch,
    naturalLanguageSearch,
    getItemDetails,
    getItemPages,
    getPageImage,
    getPageText,
    getPageOcr,
    sequentialReporting,
  ];

  // Register tools/list handler
  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => {
      logger.info('[TOOL] tools/list requested');
      const toolList = tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      logger.info(`[TOOL] Returning ${toolList.length} tools: ${toolList.map(t => t.name).join(', ')}`);
      return {
        tools: toolList,
      };
    }
  );

  // Register tools/call handler
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      logger.info(`[TOOL] Tool call requested: ${request.params.name}`);
      logger.info(`[TOOL] Tool arguments: ${JSON.stringify(request.params.arguments, null, 2)}`);
      
      const tool = tools.find((t) => t.name === request.params.name);
      if (!tool) {
        logger.error(`[TOOL] Tool not found: ${request.params.name || 'unknown'}`);
        logger.info(`[TOOL] Available tools: ${tools.map(t => t.name).join(', ')}`);
        throw new Error(`Tool not found: ${request.params.name || 'unknown'}`);
      }

      try {
        logger.info(`[TOOL] Executing tool: ${tool.name}`);
        logger.debug(`[TOOL] Tool handler called with arguments:`, request.params.arguments);
        const result = await tool.handler(request.params.arguments);
        logger.info(`[TOOL] Tool ${tool.name} completed successfully`);
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        logger.debug(`[TOOL] Tool result type: ${typeof result}, length: ${resultStr.length}`);
        
        const response = {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
        
        logger.info(`[TOOL] Returning response for ${tool.name}`);
        return response;
      } catch (error) {
        logger.error(`[TOOL] Error in tool ${tool.name}:`, error instanceof Error ? error.message : String(error));
        logger.error(`[TOOL] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
        throw error;
      }
    }
  );

  // Handle errors
  server.onerror = (error) => {
    logger.error('MCP Server error:', error);
  };

  logger.info('MCP Server initialized with 12 tools');
  return server;
}

/**
 * Handle a JSON-RPC request directly (for stateless HTTP requests)
 */
export async function handleRequestDirectly(
  server: Server,
  method: string,
  params: unknown
): Promise<unknown | null> {
  // Handle MCP protocol methods
  if (method === 'initialize') {
    // Initialize request - return server capabilities
    const handler = (server as any)._requestHandlers?.get('initialize');
    if (handler) {
      const result = await handler({ method: 'initialize', params: params || {} }, { signal: new AbortController().signal });
      return result;
    }
    // Fallback: return basic initialize response
    const iconUrl = getIconUrl();
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'gallica-bnf-api',
        version: '1.0.0',
        ...(iconUrl ? { icon: iconUrl } : {}),
      },
    };
  } else if (method === 'notifications/initialized') {
    // Notification - no response needed (return null)
    logger.info('[MCP] Received initialized notification');
    return null;
  } else if (method === 'tools/list') {
    const handler = (server as any)._requestHandlers?.get('tools/list');
    if (handler) {
      try {
        const abortController = new AbortController();
        const result = await handler({ method: 'tools/list', params: params || {} }, { signal: abortController.signal });
        return result;
      } catch (error) {
        logger.error(`[MCP] Error in tools/list handler:`, error instanceof Error ? error.message : String(error));
        logger.error(`[MCP] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
        throw error;
      }
    }
    throw new Error('tools/list handler not found');
  } else if (method === 'tools/call') {
    const handler = (server as any)._requestHandlers?.get('tools/call');
    if (handler) {
      try {
        const abortController = new AbortController();
        const result = await handler({ method: 'tools/call', params: params || {} }, { signal: abortController.signal });
        return result;
      } catch (error) {
        logger.error(`[MCP] Error in tools/call handler:`, error instanceof Error ? error.message : String(error));
        logger.error(`[MCP] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
        throw error;
      }
    }
    throw new Error('tools/call handler not found');
  } else {
    throw new Error(`Unknown method: ${method}`);
  }
}

/**
 * Start MCP server with STDIO transport
 */
export async function startMCPServer(): Promise<void> {
  const server = await createMCPServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP Server started (STDIO transport)');
}

