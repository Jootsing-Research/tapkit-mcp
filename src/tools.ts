/**
 * MCP Tool Definitions for TapKit
 */

import { TapKitClient, TapKitAPIError } from './tapkit-client.js';

// Tool input schemas (JSON Schema format)
export const toolDefinitions = [
  {
    name: 'list_phones',
    description: 'List all connected phones. Use this to see which devices are available.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'select_phone',
    description: 'Select which phone to control by its ID. Use list_phones first to see available phones and their IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'The ID of the phone to select'
        }
      },
      required: ['phone_id']
    }
  },
  {
    name: 'screenshot',
    description: 'Take a screenshot of the iPhone screen. Returns the current screen state as an image. Use this to see what is on screen before and after actions.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'tap',
    description: 'Tap at specific x,y coordinates on the screen. Use screenshot first to identify the location.',
    inputSchema: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'X coordinate (pixels from left)'
        },
        y: {
          type: 'number',
          description: 'Y coordinate (pixels from top)'
        }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'type_text',
    description: 'Type text into the currently focused text field. Make sure a text field is active first (tap it if needed).',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text to type'
        }
      },
      required: ['text']
    }
  },
  {
    name: 'press_home',
    description: 'Press the home button to go to the home screen or exit the current app.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'swipe',
    description: 'Perform a swipe gesture from one point to another. Useful for scrolling, dismissing, or navigating.',
    inputSchema: {
      type: 'object',
      properties: {
        start_x: {
          type: 'number',
          description: 'Starting X coordinate'
        },
        start_y: {
          type: 'number',
          description: 'Starting Y coordinate'
        },
        end_x: {
          type: 'number',
          description: 'Ending X coordinate'
        },
        end_y: {
          type: 'number',
          description: 'Ending Y coordinate'
        }
      },
      required: ['start_x', 'start_y', 'end_x', 'end_y']
    }
  },
  {
    name: 'scroll',
    description: 'Scroll the screen slowly (pan gesture). Use direction helpers: scroll down = start high, end low. Scroll up = start low, end high.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Direction to scroll'
        },
        distance: {
          type: 'number',
          description: 'Distance to scroll in pixels (default: 300)'
        }
      },
      required: ['direction']
    }
  },
  {
    name: 'double_tap',
    description: 'Double tap at specific coordinates. Useful for zooming or selecting text.',
    inputSchema: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'X coordinate'
        },
        y: {
          type: 'number',
          description: 'Y coordinate'
        }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'long_press',
    description: 'Long press (tap and hold) at specific coordinates. Useful for context menus or drag operations.',
    inputSchema: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'X coordinate'
        },
        y: {
          type: 'number',
          description: 'Y coordinate'
        },
        duration: {
          type: 'number',
          description: 'Duration to hold in milliseconds (default: 1000)'
        }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'lock',
    description: 'Lock the iPhone screen.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'unlock',
    description: 'Unlock the iPhone screen.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'volume_up',
    description: 'Increase the volume.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'volume_down',
    description: 'Decrease the volume.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'spotlight',
    description: 'Open Spotlight search. Optionally provide a query to search for.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (optional)'
        }
      },
      required: []
    }
  },
  {
    name: 'activate_siri',
    description: 'Activate Siri voice assistant.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'run_shortcut',
    description: 'Run an iOS Shortcut by name.',
    inputSchema: {
      type: 'object',
      properties: {
        shortcut_name: {
          type: 'string',
          description: 'Name of the iOS Shortcut to run'
        }
      },
      required: ['shortcut_name']
    }
  },
];

/**
 * Execute a tool with the given arguments
 */
export async function executeTool(
  client: TapKitClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> {
  try {
    switch (toolName) {
      case 'list_phones': {
        const phones = await client.listPhones();
        if (phones.length === 0) {
          return {
            content: [{ type: 'text', text: 'No phones found. Make sure TapKit is set up and a phone is connected.' }]
          };
        }
        const phoneList = phones.map(p => `- ${p.name} (ID: ${p.id})`).join('\n');
        return {
          content: [{ type: 'text', text: `Found ${phones.length} phone(s):\n${phoneList}` }]
        };
      }

      case 'select_phone': {
        const { phone_id } = args as { phone_id: string };
        const phones = await client.listPhones();
        const phone = phones.find(p => p.id === phone_id);
        if (!phone) {
          return {
            content: [{ type: 'text', text: `Phone not found with ID: ${phone_id}` }]
          };
        }
        client.setPhoneId(phone_id);
        return {
          content: [{ type: 'text', text: `Selected phone: ${phone.name}` }]
        };
      }

      case 'screenshot': {
        const imageBuffer = await client.screenshot();
        // Return as base64 image
        const base64 = imageBuffer.toString('base64');
        return {
          content: [
            {
              type: 'image',
              data: base64,
              mimeType: 'image/png'
            }
          ]
        };
      }

      case 'tap': {
        const { x, y } = args as { x: number; y: number };
        await client.tap(x, y);
        return {
          content: [{ type: 'text', text: `Tapped at (${x}, ${y})` }]
        };
      }

      case 'type_text': {
        const { text } = args as { text: string };
        await client.typeText(text);
        return {
          content: [{ type: 'text', text: `Typed: "${text}"` }]
        };
      }

      case 'press_home': {
        await client.pressHome();
        return {
          content: [{ type: 'text', text: 'Pressed home button' }]
        };
      }

      case 'swipe': {
        const { start_x, start_y, end_x, end_y } = args as {
          start_x: number;
          start_y: number;
          end_x: number;
          end_y: number;
        };
        await client.swipe(start_x, start_y, end_x, end_y);
        return {
          content: [{ type: 'text', text: `Swiped from (${start_x}, ${start_y}) to (${end_x}, ${end_y})` }]
        };
      }

      case 'scroll': {
        const { direction, distance = 300 } = args as {
          direction: 'up' | 'down' | 'left' | 'right';
          distance?: number;
        };
        // Calculate scroll coordinates based on direction
        // Assuming screen center is around (200, 400) for iPhone
        const centerX = 200;
        const centerY = 400;
        let startX = centerX, startY = centerY, endX = centerX, endY = centerY;

        switch (direction) {
          case 'up':
            startY = centerY + distance / 2;
            endY = centerY - distance / 2;
            break;
          case 'down':
            startY = centerY - distance / 2;
            endY = centerY + distance / 2;
            break;
          case 'left':
            startX = centerX + distance / 2;
            endX = centerX - distance / 2;
            break;
          case 'right':
            startX = centerX - distance / 2;
            endX = centerX + distance / 2;
            break;
        }

        await client.scroll(startX, startY, endX, endY);
        return {
          content: [{ type: 'text', text: `Scrolled ${direction}` }]
        };
      }

      case 'double_tap': {
        const { x, y } = args as { x: number; y: number };
        await client.doubleTap(x, y);
        return {
          content: [{ type: 'text', text: `Double tapped at (${x}, ${y})` }]
        };
      }

      case 'long_press': {
        const { x, y, duration } = args as { x: number; y: number; duration?: number };
        await client.longPress(x, y, duration);
        return {
          content: [{ type: 'text', text: `Long pressed at (${x}, ${y}) for ${duration || 1000}ms` }]
        };
      }

      case 'lock': {
        await client.lock();
        return {
          content: [{ type: 'text', text: 'Locked the device' }]
        };
      }

      case 'unlock': {
        await client.unlock();
        return {
          content: [{ type: 'text', text: 'Unlocked the device' }]
        };
      }

      case 'volume_up': {
        await client.volumeUp();
        return {
          content: [{ type: 'text', text: 'Increased volume' }]
        };
      }

      case 'volume_down': {
        await client.volumeDown();
        return {
          content: [{ type: 'text', text: 'Decreased volume' }]
        };
      }

      case 'spotlight': {
        const { query } = args as { query?: string };
        await client.spotlight(query);
        return {
          content: [{ type: 'text', text: query ? `Opened Spotlight and searched for: ${query}` : 'Opened Spotlight' }]
        };
      }

      case 'activate_siri': {
        await client.activateSiri();
        return {
          content: [{ type: 'text', text: 'Activated Siri' }]
        };
      }

      case 'run_shortcut': {
        const { shortcut_name } = args as { shortcut_name: string };
        await client.runShortcut(shortcut_name);
        return {
          content: [{ type: 'text', text: `Ran shortcut: ${shortcut_name}` }]
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${toolName}` }]
        };
    }
  } catch (error) {
    if (error instanceof TapKitAPIError) {
      return {
        content: [{ type: 'text', text: `Error: ${error.toUserMessage()}` }]
      };
    }
    // Log and return non-TapKit errors with full details
    console.error('Tool execution error:', error);
    const errorMessage = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }]
    };
  }
}
