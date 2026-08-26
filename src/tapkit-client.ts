/**
 * TapKit API Client
 * Wraps the TapKit REST API for use by the MCP server
 */

const TAPKIT_API_URL = process.env.TAPKIT_API_URL || 'https://api.tapkit.ai/v1';
const TAPKIT_API_TIMEOUT_MS = 35_000;

export interface Phone {
  id: string;
  name: string;
  device_name: string;
  display_name: string;
  unique_id: string;
  phone_number: string | null;
  shortcut_token: string | null;
  typing_method: string | null;
  speed: number | null;
  activation_state: string | null;
  activated_at: string | null;
  deactivated_at: string | null;
  consumes_entitlement: boolean;
  can_control: boolean;
  can_view_on_web: boolean;
  connection_status: 'online' | 'available' | 'offline';
  connected_mac_id: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface PhoneStatus {
  phone_id: string;
  phone_name: string;
  connection_status: 'online' | 'available' | 'offline';
  width: number | null;
  height: number | null;
}

export interface TapResult {
  success: boolean;
  job_id?: string;
}

export interface ClipboardTextResult {
  text: string;
  empty: boolean;
  job_id?: string;
}

export type ConsumeMode = 'pop' | 'ack';

export interface OpenUrlResult {
  action_id: string;
}

export type PinchAction = 'pinch_in' | 'pinch_out' | 'rotate_cw' | 'rotate_ccw';
export type DragSpeed = 'slow' | 'medium' | 'fast';
export type KeypressKey = 'enter' | 'escape' | 'backspace' | 'arrow_up' | 'arrow_down' | 'arrow_left' | 'arrow_right';
export type KeypressModifier = 'control' | 'shift' | 'alternate' | 'command';

export interface PinchResult {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

export interface TapKitError {
  error: string;
  message: string;
}

export const MAX_LONG_EDGE = 1344;

export interface ScreenScaling {
  nativeWidth: number;
  nativeHeight: number;
  scaledWidth: number;
  scaledHeight: number;
  scaleFactor: number; // scaledWidth / nativeWidth — always <= 1
}

export class TapKitClient {
  private authToken: string;
  private scalingCache: Map<string, ScreenScaling> = new Map();

  constructor(authToken: string) {
    this.authToken = authToken;
  }

  setAuthToken(authToken: string): void {
    this.authToken = authToken;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${TAPKIT_API_URL}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken.startsWith('tk_') || this.authToken.startsWith('ses_')) {
      headers['X-API-Key'] = this.authToken;
    } else {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TAPKIT_API_TIMEOUT_MS),
      });
    } catch (fetchError) {
      // Network error or fetch failed
      throw new TapKitAPIError(
        0,
        'NETWORK_ERROR',
        fetchError instanceof Error ? fetchError.message : 'Network request failed'
      );
    }

    if (!response.ok) {
      let errorCode = 'UNKNOWN_ERROR';
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

      let errorContext: Record<string, unknown> | undefined;
      try {
        const responseBody = await response.json();
        // Handle jootsing-server's {"detail": {"error": "...", "message": "..."}} format
        const errorData = responseBody.detail || responseBody;
        if (errorData.error) errorCode = errorData.error;
        if (errorData.message) errorMessage = errorData.message;
        if (errorData.context) errorContext = errorData.context;
      } catch {
        // Response wasn't JSON, use defaults
      }

      throw new TapKitAPIError(response.status, errorCode, errorMessage, errorContext);
    }

    // Handle screenshot endpoint which returns binary
    if (endpoint.includes('/screenshot')) {
      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer) as unknown as T;
    }

    return response.json();
  }

  /**
   * Compute scaling that caps the longest edge at MAX_LONG_EDGE (1344px),
   * so the model reasons in the same coordinate space as the image it sees.
   */
  private computeScaling(nativeWidth: number, nativeHeight: number): ScreenScaling {
    const longest = Math.max(nativeWidth, nativeHeight);
    const scaleFactor = Math.min(1.0, MAX_LONG_EDGE / longest);
    return {
      nativeWidth,
      nativeHeight,
      scaledWidth: Math.round(nativeWidth * scaleFactor),
      scaledHeight: Math.round(nativeHeight * scaleFactor),
      scaleFactor,
    };
  }

  /**
   * Cache scaling for a phone (called from tool handlers when dimensions are known)
   */
  cacheScaling(phoneId: string, nativeWidth: number, nativeHeight: number): ScreenScaling {
    const scaling = this.computeScaling(nativeWidth, nativeHeight);
    this.scalingCache.set(phoneId, scaling);
    return scaling;
  }

  /**
   * Get cached scaling for a phone (synchronous, returns null on miss)
   */
  getScaling(phoneId: string): ScreenScaling | null {
    return this.scalingCache.get(phoneId) ?? null;
  }

  /**
   * Ensure scaling is cached for a phone. On cache miss, fetches from listPhones
   * (which returns all phones with width/height in one call, populating the cache).
   */
  async ensureScaling(phoneId: string): Promise<ScreenScaling | null> {
    const cached = this.scalingCache.get(phoneId);
    if (cached) return cached;
    try {
      const phones = await this.listPhones();
      for (const p of phones) {
        if (p.width && p.height) {
          this.cacheScaling(p.id, p.width, p.height);
        }
      }
    } catch {
      // Best effort — return null if we can't fetch
    }
    return this.scalingCache.get(phoneId) ?? null;
  }

  /**
   * Convert model coordinates (scaled space) to native phone coordinates.
   * Returns coords as-is if no scaling is cached for the phone.
   */
  toNative(phoneId: string, x: number, y: number): { x: number; y: number } {
    const scaling = this.scalingCache.get(phoneId);
    if (!scaling) return { x, y };
    return {
      x: Math.round(x / scaling.scaleFactor),
      y: Math.round(y / scaling.scaleFactor),
    };
  }

  /**
   * List all phones (width/height included in API response)
   */
  async listPhones(): Promise<Phone[]> {
    return this.request<Phone[]>('GET', '/phones');
  }

  /**
   * Select and activate a phone on its connected Mac.
   * Dispatches an activate_phone job to physically switch Switch Control.
   */
  async selectPhoneOnMac(phoneId: string): Promise<Phone> {
    return this.request<Phone>('POST', `/phones/${phoneId}/select`);
  }

  /**
   * Get real-time status for a specific phone
   */
  async getPhoneStatus(phoneId: string): Promise<PhoneStatus> {
    return this.request<PhoneStatus>('GET', `/phones/${phoneId}/status`);
  }

  /**
   * Get a screenshot from the phone
   * Returns PNG image buffer
   */
  async screenshot(phoneId: string): Promise<Buffer> {
    return this.request<Buffer>('GET', `/phones/${phoneId}/screenshot`);
  }

  /**
   * Tap at specific coordinates
   */
  async tap(phoneId: string, x: number, y: number): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/tap`, { x, y });
  }

  /**
   * Tap an element by natural language description
   */
  async tapElement(phoneId: string, description: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/tap/select`, {
      description
    });
  }

  /**
   * Double tap at coordinates
   */
  async doubleTap(phoneId: string, x: number, y: number): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/double-tap`, { x, y });
  }

  async tripleTap(phoneId: string, x: number, y: number): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/triple-tap`, { x, y });
  }

  /**
   * Long press at coordinates
   */
  async longPress(phoneId: string, x: number, y: number, durationMs?: number): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/tap-and-hold`, {
      x,
      y,
      duration_ms: durationMs || 1000
    });
  }

  /**
   * Flick gesture at position in a direction
   */
  async flick(phoneId: string, x: number, y: number, direction: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/flick`, {
      x, y, direction
    });
  }

  /**
   * Drag from one point to another
   */
  async drag(phoneId: string, fromX: number, fromY: number, toX: number, toY: number, speed: DragSpeed = 'medium'): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/drag`, {
      from_x: fromX, from_y: fromY, to_x: toX, to_y: toY, speed
    });
  }

  /**
   * Long press then drag to another point
   */
  async holdAndDrag(phoneId: string, fromX: number, fromY: number, toX: number, toY: number, holdDurationMs?: number, speed: DragSpeed = 'medium'): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/hold-and-drag`, {
      from_x: fromX, from_y: fromY, to_x: toX, to_y: toY, hold_duration_ms: holdDurationMs || 500, speed
    });
  }

  /**
   * Pinch or rotate at coordinates
   */
  async pinch(phoneId: string, x: number, y: number, action: PinchAction, durationMs?: number): Promise<PinchResult> {
    return this.request<PinchResult>('POST', `/phones/${phoneId}/pinch`, {
      x,
      y,
      action,
      ...(durationMs ? { duration_ms: durationMs } : {})
    });
  }

  /**
   * Type text into active field
   */
  async typeText(phoneId: string, text: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/type`, { text });
  }

  async pressKey(
    phoneId: string,
    key: KeypressKey,
    modifiers: KeypressModifier[] = [],
    repeat: number = 1
  ): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/keypress`, { key, modifiers, repeat });
  }

  /**
   * Press home button
   */
  async pressHome(phoneId: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/home`, {});
  }

  /**
   * Open an app by name or bundle ID
   */
  async openApp(phoneId: string, appName: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/open-app`, {
      app_name: appName
    });
  }

  /**
   * Open a URL on the phone via Shortcut action queue
   */
  async openUrl(phoneId: string, url: string, consumeMode: ConsumeMode = 'pop'): Promise<OpenUrlResult> {
    return this.request<OpenUrlResult>('POST', `/phones/${phoneId}/open-url`, {
      url,
      consume_mode: consumeMode
    });
  }

  /**
   * Lock the device
   */
  async lock(phoneId: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/lock`, {});
  }

  /**
   * Unlock the device
   */
  async unlock(phoneId: string, passcode?: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/unlock`, {
      ...(passcode ? { passcode } : {})
    });
  }

  /**
   * Adjust volume up
   */
  async volumeUp(phoneId: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/volume-up`, {});
  }

  /**
   * Adjust volume down
   */
  async volumeDown(phoneId: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/volume-down`, {});
  }

  /**
   * Open Spotlight search
   */
  async spotlight(phoneId: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/spotlight`, {});
  }

  /**
   * Activate Siri
   */
  async activateSiri(phoneId: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/siri`, {});
  }

  /**
   * Press escape (dismiss keyboards, alerts, popups, etc.)
   */
  async escape(phoneId: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/escape`, {});
  }

  /**
   * Enable Switch Control on the Mac for a given phone
   */
  async enableSwitchControl(phoneId: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/switch-control/enable`, {});
  }

  /**
   * Copy text to the phone's clipboard
   */
  async copyText(phoneId: string, text: string): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/copy-text`, { text });
  }

  /**
   * Read text from the phone's clipboard
   */
  async readClipboardText(phoneId: string): Promise<ClipboardTextResult> {
    return this.request<ClipboardTextResult>('POST', `/phones/${phoneId}/read-clipboard`);
  }

  /**
   * Run an iOS Shortcut by index
   */
  async runShortcut(phoneId: string, index: number): Promise<TapResult> {
    return this.request<TapResult>('POST', `/phones/${phoneId}/shortcut`, {
      index
    });
  }
}

export class TapKitAPIError extends Error {
  status: number;
  code: string;
  context?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'TapKitAPIError';
    this.status = status;
    this.code = code;
    this.context = context;
  }

  toUserMessage(): string {
    switch (this.code) {
      case 'NO_PHONES_CONNECTED':
        return 'No phones connected. Please ensure TapKit is running and a phone is connected.';
      case 'NO_PHONE_SELECTED':
        return 'No phone is selected. Call list_phones, then pass a valid phone_id.';
      case 'PHONE_NOT_SELECTED':
        return 'Phone is connected but not active. Pass a valid phone_id and try the action again.';
      case 'PHONE_NOT_CONNECTED':
        return 'Phone is not connected to any Mac. Check that the device is online and TapKit is running.';
      case 'PHONE_NOT_FOUND':
        return 'Phone not found. The device may have been disconnected.';
      case 'MAC_APP_NOT_RUNNING':
        return 'TapKit companion app is not running on your Mac.';
      case 'TIMEOUT':
        return 'Operation timed out. The app may be unresponsive.';
      case 'INVALID_API_KEY':
      case 'INVALID_TOKEN':
        return 'Invalid API key or token. Please reconnect to TapKit.';
      case 'AUTH_REQUIRED':
        return 'Authentication required. Please sign in to TapKit.';
      case 'SUBSCRIPTION_REQUIRED':
        return 'An active TapKit subscription is required.';
      case 'NETWORK_ERROR':
        return 'TapKit could not reach the phone service. Check the connection and try again.';
      case 'USER_NOT_FOUND':
        return 'User not found. Please ensure you have a TapKit account and have connected at least once via the app.';
      case 'ORG_NOT_FOUND':
        return 'Organization not found. Please ensure your account is set up correctly.';
      default:
        if (this.status === 429) {
          return 'TapKit is receiving too many requests. Wait briefly and try again.';
        }
        if (this.status >= 500 || this.status === 0) {
          return 'TapKit is temporarily unavailable. Please try again.';
        }
        return 'TapKit could not complete this action. Check the phone state and try again.';
    }
  }
}
