import { serve } from "https://deno.land/std@0.140.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.140.0/http/file_server.ts";

console.log("Server starting...");

const debugMessages: string[] = [];

function logDebug(message: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  let logMessage = `[${timestamp}] ${message}`;
  
  if (data) {
    try {
      // Clean up data for logging
      const cleanData = typeof data === 'object' ? 
        Object.fromEntries(
          Object.entries(data).map(([key, value]) => {
            // Handle Error objects
            if (value instanceof Error) {
              return [key, {
                name: value.name,
                message: value.message,
                stack: value.stack
              }];
            }
            return [key, value];
          })
        ) : data;

      // Pretty print the data
      const prettyData = JSON.stringify(cleanData, null, 2)
        .split('\n')
        .map(line => '  ' + line)  // Indent each line
        .join('\n');
      logMessage += '\n' + prettyData;
    } catch (_e) {
      logMessage += ' [Error stringifying data]';
    }
  }
  
  console.log('\x1b[36m%s\x1b[0m', logMessage); // Cyan color for debug messages
  debugMessages.push(logMessage);
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  // Handle debug logging endpoint
  if (url.pathname === "/debug" && req.method === "POST") {
    try {
      const data = await req.json();
      
      // Log the raw data for debugging
      console.log('Raw debug data:', data);
      
      if (data.error) {
        logDebug(`ERROR: ${data.message}`, { error: data.error });
      } else if (data.data) {
        logDebug(data.message, data.data);
      } else {
        logDebug(data.message, data.browserInfo);
      }
      
      return new Response("Debug logged", { status: 200 });
    } catch (err) {
      console.error('Error processing debug data:', err);
      return new Response("Invalid debug data", { status: 400 });
    }
  }

  // Serve static files
  return await serveDir(req, {
    fsRoot: "public",
    urlRoot: "",
    showDirListing: true,
    enableCors: true,
  });
}

// Parse command line arguments
const DEFAULT_PORT = 8000;
const portArg = Deno.args.find(arg => arg.startsWith('--port='));
const port = portArg ? parseInt(portArg.split('=')[1], 10) : DEFAULT_PORT;

console.log(`QR Code Scanner server running on http://localhost:${port}`);
serve(handler, { port });
