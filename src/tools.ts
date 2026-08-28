/**
 * MCP Tool Definitions for TapKit
 */

import sharp from 'sharp';
import { TapKitClient, TapKitAPIError, MAX_LONG_EDGE, type PhoneStatus, type PinchAction, type ConsumeMode, type KeypressKey, type KeypressModifier, type DragSpeed } from './tapkit-client.js';
import { bearerChallenge } from './mcp-auth.js';

// Tool input schemas (JSON Schema format)
export const toolDefinitions = [
  {
    name: 'list_phones',
    title: 'List phones',
    description: 'List all phones with their connection status, IDs, and dimensions. ALWAYS call this first to discover phone_ids — every other phone-targeting tool requires a phone_id parameter.',
    annotations: {
      title: 'List phones',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'screenshot',
    title: 'Take screenshot',
    description: 'Take a screenshot of the iPhone screen. Returns the current screen state as an image. Use this to see what is on screen before and after actions.',
    annotations: {
      title: 'Take screenshot',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        }
      },
      required: ['phone_id']
    }
  },
  {
    name: 'tap',
    title: 'Tap screen',
    description: 'Tap at specific x,y coordinates on the screen. Use screenshot first to identify the location.',
    annotations: {
      title: 'Tap screen',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        },
        x: {
          type: 'number',
          description: 'X coordinate (pixels from left)'
        },
        y: {
          type: 'number',
          description: 'Y coordinate (pixels from top)'
        }
      },
      required: ['phone_id', 'x', 'y']
    }
  },
  {
    name: 'type_text',
    title: 'Type text',
    description: 'Type text into the currently focused text field through the TapKit type API. Only US-ASCII text of at most 100 characters is supported; Unicode characters are rejected. Make sure a text field is active first (tap it if needed).',
    annotations: {
      title: 'Type text',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        },
        text: {
          type: 'string',
          description: 'US-ASCII text to type, at most 100 characters. Unicode characters are not supported.'
        }
      },
      required: ['phone_id', 'text']
    }
  },
  {
    name: 'press_home',
    title: 'Press Home',
    description: 'Press the home button to go to the home screen or exit the current app.',
    annotations: {
      title: 'Press Home',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        }
      },
      required: ['phone_id']
    }
  },
  {
    name: 'press_key',
    title: 'Press keyboard key',
    description: 'Press enter, escape, backspace, or an arrow key on the active iPhone, optionally holding modifier keys.',
    annotations: {
      title: 'Press keyboard key',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        },
        key: {
          type: 'string',
          enum: ['enter', 'escape', 'backspace', 'arrow_up', 'arrow_down', 'arrow_left', 'arrow_right'],
          description: 'Keyboard key to press'
        },
        modifiers: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['control', 'shift', 'alternate', 'command']
          },
          description: 'Modifier keys to hold while pressing the key'
        },
        repeat: {
          type: 'integer',
          minimum: 1,
          default: 1,
          description: 'Number of times to press the key'
        }
      },
      required: ['phone_id', 'key']
    }
  },
  {
    name: 'swipe',
    title: 'Swipe screen',
    description: 'Perform a fast flick/swipe gesture at a position. Useful for dismissing, switching pages, or quick scrolling.',
    annotations: {
      title: 'Swipe screen',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        },
        x: {
          type: 'number',
          description: 'X coordinate to swipe from'
        },
        y: {
          type: 'number',
          description: 'Y coordinate to swipe from'
        },
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Direction to swipe'
        }
      },
      required: ['phone_id', 'x', 'y', 'direction']
    }
  },
  {
    name: 'drag',
    title: 'Drag on screen',
    description: 'Drag from one point to another. Useful for moving sliders, reordering items, or precise scroll gestures.',
    annotations: {
      title: 'Drag on screen',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        },
        from_x: { type: 'number', description: 'Starting X coordinate' },
        from_y: { type: 'number', description: 'Starting Y coordinate' },
        to_x: { type: 'number', description: 'Ending X coordinate' },
        to_y: { type: 'number', description: 'Ending Y coordinate' },
        speed: {
          type: 'string',
          enum: ['slow', 'medium', 'fast'],
          description: 'Drag speed (default: medium)'
        }
      },
      required: ['phone_id', 'from_x', 'from_y', 'to_x', 'to_y']
    }
  },
  {
    name: 'hold_and_drag',
    title: 'Hold and drag',
    description: 'Long press then drag to another point. Useful for drag-and-drop, reordering lists, or moving items.',
    annotations: {
      title: 'Hold and drag',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        },
        from_x: { type: 'number', description: 'Starting X coordinate' },
        from_y: { type: 'number', description: 'Starting Y coordinate' },
        to_x: { type: 'number', description: 'Ending X coordinate' },
        to_y: { type: 'number', description: 'Ending Y coordinate' },
        hold_duration_ms: { type: 'number', description: 'How long to hold before dragging in ms (default: 500)' },
        speed: {
          type: 'string',
          enum: ['slow', 'medium', 'fast'],
          description: 'Drag speed (default: medium)'
        }
      },
      required: ['phone_id', 'from_x', 'from_y', 'to_x', 'to_y']
    }
  },
  // {
  //   name: 'pinch',
  //   description: 'Perform a pinch or rotate gesture centered at specific coordinates. Useful for zooming or rotating content.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       phone_id: {
  //         type: 'string',
  //         description: 'Phone ID. Call list_phones first to discover available phone IDs.'
  //       },
  //       x: {
  //         type: 'number',
  //         description: 'Center X coordinate'
  //       },
  //       y: {
  //         type: 'number',
  //         description: 'Center Y coordinate'
  //       },
  //       action: {
  //         type: 'string',
  //         enum: ['pinch_in', 'pinch_out', 'rotate_cw', 'rotate_ccw'],
  //         description: 'Gesture to perform'
  //       },
  //       duration_ms: {
  //         type: 'number',
  //         description: 'Duration of the gesture in milliseconds (default: 1000)'
  //       }
  //     },
  //     required: ['phone_id', 'x', 'y', 'action']
  //   }
  // },
  {
    name: 'double_tap',
    title: 'Double tap screen',
    description: 'Double tap at specific coordinates. Useful for zooming or selecting text.',
    annotations: {
      title: 'Double tap screen',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        },
        x: {
          type: 'number',
          description: 'X coordinate'
        },
        y: {
          type: 'number',
          description: 'Y coordinate'
        }
      },
      required: ['phone_id', 'x', 'y']
    }
  },
  {
    name: 'triple_tap',
    title: 'Triple tap screen',
    description: 'Triple tap at specific coordinates.',
    annotations: {
      title: 'Triple tap screen',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        },
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' }
      },
      required: ['phone_id', 'x', 'y']
    }
  },
  {
    name: 'long_press',
    title: 'Long press screen',
    description: 'Long press (tap and hold) at specific coordinates. Useful for context menus or drag operations.',
    annotations: {
      title: 'Long press screen',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        },
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
      required: ['phone_id', 'x', 'y']
    }
  },
  {
    name: 'lock',
    title: 'Lock phone',
    description: 'Lock the iPhone screen.',
    annotations: {
      title: 'Lock phone',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        }
      },
      required: ['phone_id']
    }
  },
  {
    name: 'unlock',
    title: 'Unlock phone',
    description: 'Unlock the iPhone screen.',
    annotations: {
      title: 'Unlock phone',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'Phone ID. Call list_phones first to discover available phone IDs.'
        }
      },
      required: ['phone_id']
    }
  },
  // {
  //   name: 'volume_up',
  //   description: 'Increase the volume.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       phone_id: {
  //         type: 'string',
  //         description: 'Phone ID. Call list_phones first to discover available phone IDs.'
  //       }
  //     },
  //     required: ['phone_id']
  //   }
  // },
  // {
  //   name: 'volume_down',
  //   description: 'Decrease the volume.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       phone_id: {
  //         type: 'string',
  //         description: 'Phone ID. Call list_phones first to discover available phone IDs.'
  //       }
  //     },
  //     required: ['phone_id']
  //   }
  // },
  // {
  //   name: 'spotlight',
  //   description: 'Open Spotlight.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       phone_id: {
  //         type: 'string',
  //         description: 'Phone ID. Call list_phones first to discover available phone IDs.'
  //       }
  //     },
  //     required: ['phone_id']
  //   }
  // },
  // {
  //   name: 'activate_siri',
  //   description: 'Activate Siri voice assistant.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       phone_id: {
  //         type: 'string',
  //         description: 'Phone ID. Call list_phones first to discover available phone IDs.'
  //       }
  //     },
  //     required: ['phone_id']
  //   }
  // },
  // {
  //   name: 'run_shortcut',
  //   description: 'Run an iOS Shortcut by its index number in the shortcuts menu.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       phone_id: {
  //         type: 'string',
  //         description: 'Phone ID. Call list_phones first to discover available phone IDs.'
  //       },
  //       index: {
  //         type: 'number',
  //         description: 'Index of the shortcut to run (0-based)'
  //       }
  //     },
  //     required: ['phone_id', 'index']
  //   }
  // },
  // {
  //   name: 'escape',
  //   description: 'Press escape to dismiss keyboards, alerts, popups, or modal screens.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       phone_id: {
  //         type: 'string',
  //         description: 'Phone ID. Call list_phones first to discover available phone IDs.'
  //       }
  //     },
  //     required: ['phone_id']
  //   }
  // },
  // {
  //   name: 'open_app',
  //   description: 'Open an app by name or bundle ID. Examples: "Safari", "com.apple.mobilesafari".',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       phone_id: {
  //         type: 'string',
  //         description: 'Phone ID. Call list_phones first to discover available phone IDs.'
  //       },
  //       app_name: {
  //         type: 'string',
  //         description: 'The app name (e.g. "Safari", "Settings") or bundle ID (e.g. "com.apple.mobilesafari")'
  //       }
  //     },
  //     required: ['phone_id', 'app_name']
  //   }
  // },
  // {
  //   name: 'open_url',
  //   description: 'Open a URL on the phone via the Shortcut action queue. Default consume_mode is pop; use ack when the Shortcut must explicitly acknowledge completion.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       phone_id: {
  //         type: 'string',
  //         description: 'Phone ID. Call list_phones first to discover available phone IDs.'
  //       },
  //       url: {
  //         type: 'string',
  //         description: 'The absolute URL to open, for example "https://example.com/setup".'
  //       },
  //       consume_mode: {
  //         type: 'string',
  //         enum: ['pop', 'ack'],
  //         description: 'How the Shortcut consumes the queued action. Defaults to pop.'
  //       }
  //     },
  //     required: ['phone_id', 'url']
  //   }
  // },
  // {
  //   name: 'copy_text_to_phone',
  //   description: 'Load text into a phone\'s clipboard. After this completes, the text is on the phone\'s clipboard and can be pasted anywhere.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       phone_id: {
  //         type: 'string',
  //         description: 'Phone ID. Call list_phones first to discover available phone IDs.'
  //       },
  //       text: {
  //         type: 'string',
  //         description: 'The text to copy to the clipboard'
  //       }
  //     },
  //     required: ['phone_id', 'text']
  //   }
  // },
  // {
  //   name: 'get_clipboard_text_from_phone',
  //   description: 'Read the current text from a phone\'s clipboard.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       phone_id: {
  //         type: 'string',
  //         description: 'Phone ID. Call list_phones first to discover available phone IDs.'
  //       }
  //     },
  //     required: ['phone_id']
  //   }
  // },
  {
    name: 'get_phone_status',
    title: 'Get phone status',
    description: 'Get real-time status of a phone including connection state and screen dimensions.',
    annotations: {
      title: 'Get phone status',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        phone_id: {
          type: 'string',
          description: 'The ID of the phone to check status for'
        }
      },
      required: ['phone_id']
    }
  },
  // {
  //   name: 'get_phone_info',
  //   description: '(Deprecated — use get_phone_status instead) Get screen dimensions and device info for a phone.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       phone_id: {
  //         type: 'string',
  //         description: 'Phone ID. Call list_phones first to discover available phone IDs.'
  //       }
  //     },
  //     required: ['phone_id']
  //   }
  // },
];

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

function toolError(error: TapKitAPIError): ToolResult {
  const result: ToolResult = {
    content: [{ type: 'text', text: `Error: ${error.toUserMessage()}` }],
    isError: true,
  };
  if (error.status === 401
    || ['INVALID_API_KEY', 'INVALID_TOKEN', 'AUTH_REQUIRED'].includes(error.code)) {
    result.content = [{
      type: 'text',
      text: 'Your TapKit connection needs to be renewed. Reconnect TapKit and try again.',
    }];
    result._meta = {
      'mcp/www_authenticate': [bearerChallenge('invalid')],
    };
  }
  return result;
}

/**
 * Inner tool execution — dispatches to the correct handler.
 * Every phone-targeting tool reads its own phone_id from args.
 */
async function executeToolInner(
  client: TapKitClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  switch (toolName) {
    case 'list_phones': {
      const phones = await client.listPhones();
      // Populate scaling cache so subsequent action calls don't pay the cache-miss penalty
      for (const p of phones) {
        if (p.width && p.height) client.cacheScaling(p.id, p.width, p.height);
      }
      if (phones.length === 0) {
        return {
          content: [{ type: 'text', text: 'No phones found. Make sure TapKit is set up and a phone is connected.' }]
        };
      }
      const phoneList = phones.map(p => {
        const name = p.display_name || p.name;
        const status = p.connection_status.toUpperCase();
        let line = `- ${name} [${status}] (ID: ${p.id})`;
        if (p.width && p.height) line += ` ${p.width}x${p.height}`;
        return line;
      }).join('\n');
      return {
        content: [{ type: 'text', text: `Found ${phones.length} phone(s):\n${phoneList}` }]
      };
    }

    case 'screenshot': {
      const phoneId = args.phone_id as string;
      const imageBuffer = await client.screenshot(phoneId);
      let scaling = client.getScaling(phoneId);

      let reportW: number;
      let reportH: number;
      let pipeline: ReturnType<typeof sharp>;

      if (scaling) {
        pipeline = sharp(imageBuffer)
          .resize(scaling.scaledWidth, scaling.scaledHeight, { fit: 'inside' });
        reportW = scaling.scaledWidth;
        reportH = scaling.scaledHeight;
      } else {
        // No cached scaling — read native dims from PNG metadata and cache them
        const meta = await sharp(imageBuffer).metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        if (w && h) {
          scaling = client.cacheScaling(phoneId, w, h);
          pipeline = sharp(imageBuffer)
            .resize(scaling.scaledWidth, scaling.scaledHeight, { fit: 'inside' });
          reportW = scaling.scaledWidth;
          reportH = scaling.scaledHeight;
        } else {
          reportW = w;
          reportH = h;
          pipeline = sharp(imageBuffer);
        }
      }

      const resizedBuffer = await pipeline.jpeg({ quality: 80 }).toBuffer();
      const base64 = resizedBuffer.toString('base64');
      return {
        content: [
          { type: 'text', text: `Screenshot: ${reportW}x${reportH}. Coordinates for tap/swipe map 1:1 with image pixels.` },
          {
            type: 'image',
            data: base64,
            mimeType: 'image/jpeg'
          }
        ]
      };
    }

    case 'tap': {
      const { phone_id, x, y } = args as { phone_id: string; x: number; y: number };
      await client.ensureScaling(phone_id);
      const native = client.toNative(phone_id, x, y);
      await client.tap(phone_id, native.x, native.y);
      return {
        content: [{ type: 'text', text: `Tapped at (${x}, ${y})` }]
      };
    }

    case 'type_text': {
      const { phone_id, text } = args as { phone_id: string; text: string };
      await client.typeText(phone_id, text);
      return {
        content: [{ type: 'text', text: `Typed text into active field` }]
      };
    }

    case 'press_key': {
      const { phone_id, key, modifiers = [], repeat = 1 } = args as {
        phone_id: string;
        key: KeypressKey;
        modifiers?: KeypressModifier[];
        repeat?: number;
      };
      await client.pressKey(phone_id, key, modifiers, repeat);
      const chord = modifiers.length > 0 ? `${modifiers.join('+')}+` : '';
      return {
        content: [{ type: 'text', text: `Pressed ${chord}${key} ${repeat} time${repeat === 1 ? '' : 's'}` }]
      };
    }

    case 'press_home': {
      const phoneId = args.phone_id as string;
      await client.pressHome(phoneId);
      return {
        content: [{ type: 'text', text: 'Pressed home button' }]
      };
    }

    case 'swipe': {
      const { phone_id, x, y, direction } = args as { phone_id: string; x: number; y: number; direction: string };
      await client.ensureScaling(phone_id);
      const native = client.toNative(phone_id, x, y);
      await client.flick(phone_id, native.x, native.y, direction);
      return {
        content: [{ type: 'text', text: `Swiped ${direction} at (${x}, ${y})` }]
      };
    }

    case 'drag': {
      const { phone_id, from_x, from_y, to_x, to_y, speed } = args as {
        phone_id: string; from_x: number; from_y: number; to_x: number; to_y: number; speed?: DragSpeed;
      };
      await client.ensureScaling(phone_id);
      const nFrom = client.toNative(phone_id, from_x, from_y);
      const nTo = client.toNative(phone_id, to_x, to_y);
      await client.drag(phone_id, nFrom.x, nFrom.y, nTo.x, nTo.y, speed);
      return {
        content: [{ type: 'text', text: `Dragged from (${from_x}, ${from_y}) to (${to_x}, ${to_y})` }]
      };
    }

    case 'hold_and_drag': {
      const { phone_id, from_x, from_y, to_x, to_y, hold_duration_ms, speed } = args as {
        phone_id: string; from_x: number; from_y: number; to_x: number; to_y: number; hold_duration_ms?: number; speed?: DragSpeed;
      };
      await client.ensureScaling(phone_id);
      const nFrom = client.toNative(phone_id, from_x, from_y);
      const nTo = client.toNative(phone_id, to_x, to_y);
      await client.holdAndDrag(phone_id, nFrom.x, nFrom.y, nTo.x, nTo.y, hold_duration_ms, speed);
      return {
        content: [{ type: 'text', text: `Hold and dragged from (${from_x}, ${from_y}) to (${to_x}, ${to_y})` }]
      };
    }

    // case 'pinch': {
    //   const { phone_id, x, y, action, duration_ms } = args as {
    //     phone_id: string; x: number; y: number; action: PinchAction; duration_ms?: number;
    //   };
    //   await client.ensureScaling(phone_id);
    //   const native = client.toNative(phone_id, x, y);
    //   const result = await client.pinch(phone_id, native.x, native.y, action, duration_ms);
    //   const id = result.id ? `, job: ${result.id}` : '';
    //   return {
    //     content: [{ type: 'text', text: `Performed ${action} at (${x}, ${y}) for ${duration_ms || 1000}ms (status: ${result.status}${id})` }]
    //   };
    // }

    case 'double_tap': {
      const { phone_id, x, y } = args as { phone_id: string; x: number; y: number };
      await client.ensureScaling(phone_id);
      const native = client.toNative(phone_id, x, y);
      await client.doubleTap(phone_id, native.x, native.y);
      return {
        content: [{ type: 'text', text: `Double tapped at (${x}, ${y})` }]
      };
    }

    case 'triple_tap': {
      const { phone_id, x, y } = args as { phone_id: string; x: number; y: number };
      await client.ensureScaling(phone_id);
      const native = client.toNative(phone_id, x, y);
      await client.tripleTap(phone_id, native.x, native.y);
      return {
        content: [{ type: 'text', text: `Triple tapped at (${x}, ${y})` }]
      };
    }

    case 'long_press': {
      const { phone_id, x, y, duration } = args as { phone_id: string; x: number; y: number; duration?: number };
      await client.ensureScaling(phone_id);
      const native = client.toNative(phone_id, x, y);
      await client.longPress(phone_id, native.x, native.y, duration);
      return {
        content: [{ type: 'text', text: `Long pressed at (${x}, ${y}) for ${duration || 1000}ms` }]
      };
    }

    case 'lock': {
      const phoneId = args.phone_id as string;
      await client.lock(phoneId);
      return {
        content: [{ type: 'text', text: 'Locked the device' }]
      };
    }

    case 'unlock': {
      const phoneId = args.phone_id as string;
      await client.unlock(phoneId);
      return {
        content: [{ type: 'text', text: 'Unlocked the device' }]
      };
    }

    // case 'volume_up': {
    //   const phoneId = args.phone_id as string;
    //   await client.volumeUp(phoneId);
    //   return {
    //     content: [{ type: 'text', text: 'Increased volume' }]
    //   };
    // }

    // case 'volume_down': {
    //   const phoneId = args.phone_id as string;
    //   await client.volumeDown(phoneId);
    //   return {
    //     content: [{ type: 'text', text: 'Decreased volume' }]
    //   };
    // }

    // case 'spotlight': {
    //   const phoneId = args.phone_id as string;
    //   await client.spotlight(phoneId);
    //   return {
    //     content: [{ type: 'text', text: 'Opened Spotlight' }]
    //   };
    // }

    // case 'activate_siri': {
    //   const phoneId = args.phone_id as string;
    //   await client.activateSiri(phoneId);
    //   return {
    //     content: [{ type: 'text', text: 'Activated Siri' }]
    //   };
    // }

    // case 'run_shortcut': {
    //   const { phone_id, index } = args as { phone_id: string; index: number };
    //   await client.runShortcut(phone_id, index);
    //   return {
    //     content: [{ type: 'text', text: `Ran shortcut at index: ${index}` }]
    //   };
    // }

    // case 'escape': {
    //   const phoneId = args.phone_id as string;
    //   await client.escape(phoneId);
    //   return {
    //     content: [{ type: 'text', text: 'Pressed escape' }]
    //   };
    // }

    // case 'copy_text_to_phone': {
    //   const { phone_id, text } = args as { phone_id: string; text: string };
    //   await client.copyText(phone_id, text);
    //   return {
    //     content: [{ type: 'text', text: `Copied text to phone clipboard` }]
    //   };
    // }

    // case 'get_clipboard_text_from_phone': {
    //   const phoneId = args.phone_id as string;
    //   const result = await client.readClipboardText(phoneId);
    //   return {
    //     content: [{ type: 'text', text: result.empty ? 'Phone clipboard is empty' : `Phone clipboard text:\n${result.text}` }]
    //   };
    // }

    // case 'open_app': {
    //   const { phone_id, app_name } = args as { phone_id: string; app_name: string };
    //   await client.openApp(phone_id, app_name);
    //   return {
    //     content: [{ type: 'text', text: `Opened app: ${app_name}` }]
    //   };
    // }

    // case 'open_url': {
    //   const { phone_id, url, consume_mode } = args as { phone_id: string; url: string; consume_mode?: ConsumeMode };
    //   const result = await client.openUrl(phone_id, url, consume_mode);
    //   return {
    //     content: [{ type: 'text', text: `Queued URL open action: ${url} (action_id: ${result.action_id})` }]
    //   };
    // }

    case 'get_phone_status': {
      const phoneId = args.phone_id as string;
      const status: PhoneStatus = await client.getPhoneStatus(phoneId);
      // Cache scaling while we have dims
      if (status.width && status.height) {
        client.cacheScaling(phoneId, status.width, status.height);
      }
      const lines = [
        `Phone: ${status.phone_name}`,
        `Status: ${status.connection_status}`,
      ];
      if (status.width && status.height) {
        lines.push(`Dimensions: ${status.width}x${status.height}`);
      }
      return {
        content: [{ type: 'text', text: lines.join('\n') }]
      };
    }

    // case 'get_phone_info': {
    //   const phoneId = args.phone_id as string;
    //   const status = await client.getPhoneStatus(phoneId);
    //   if (status.width && status.height) {
    //     client.cacheScaling(phoneId, status.width, status.height);
    //   }
    //   return {
    //     content: [{ type: 'text', text: `Screen: ${status.width}x${status.height}, Name: ${status.phone_name}` }]
    //   };
    // }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }]
      };
  }
}

/**
 * Execute a tool with the given arguments.
 * Automatically handles PHONE_NOT_SELECTED by selecting the phone and retrying once.
 */
export async function executeTool(
  client: TapKitClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    return await executeToolInner(client, toolName, args);
  } catch (error) {
    // Auto-select and retry on PHONE_NOT_SELECTED (409)
    if (
      error instanceof TapKitAPIError &&
      error.code === 'PHONE_NOT_SELECTED' &&
      error.status === 409
    ) {
      const phoneId = (error.context?.phone_id as string) || (args.phone_id as string);
      if (phoneId) {
        try {
          const phone = await client.selectPhoneOnMac(phoneId);
          if (phone.width && phone.height) {
            client.cacheScaling(phoneId, phone.width, phone.height);
          }
          return await executeToolInner(client, toolName, args);
        } catch (retryError) {
          if (retryError instanceof TapKitAPIError) {
            return toolError(retryError);
          }
          throw retryError;
        }
      }
    }
    if (error instanceof TapKitAPIError) {
      return toolError(error);
    }
    const errorId = crypto.randomUUID();
    console.error(`TapKit tool execution failed (${errorId})`);
    return {
      content: [{
        type: 'text',
        text: `TapKit could not complete this action. Try again, or contact support with error ID ${errorId}.`,
      }],
      isError: true,
    };
  }
}
