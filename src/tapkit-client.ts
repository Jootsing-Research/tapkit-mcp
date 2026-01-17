/**
 * TapKit API Client
 * Wraps the TapKit REST API for use by the MCP server
 */

const TAPKIT_API_URL = process.env.TAPKIT_API_URL || 'https://api.tapkit.ai/v1';

export interface Phone {
  id: string;
  name: string;
  unique_id: string;
  phone_number: string | null;
}

export interface TapResult {
  success: boolean;
  job_id?: string;
}

export interface TapKitError {
  error: string;
  message: string;
}

export class TapKitClient {
  private authToken: string;
  private phoneId: string | null = null;

  constructor(authToken: string) {
    this.authToken = authToken;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${TAPKIT_API_URL}${endpoint}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.authToken}`,
      'Content-Type': 'application/json',
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
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
      let errorData: { error?: string; message?: string };
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          error: 'UNKNOWN_ERROR',
          message: `HTTP ${response.status}: ${response.statusText}`
        };
      }
      throw new TapKitAPIError(
        response.status,
        errorData.error || 'UNKNOWN_ERROR',
        errorData.message || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    // Handle screenshot endpoint which returns binary
    if (endpoint.includes('/screenshot')) {
      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer) as unknown as T;
    }

    return response.json();
  }

  /**
   * Get the current phone ID, auto-selecting if not set
   */
  async getPhoneId(): Promise<string> {
    if (this.phoneId) {
      return this.phoneId;
    }

    const phones = await this.listPhones();
    if (phones.length === 0) {
      throw new TapKitAPIError(
        404,
        'NO_PHONES_CONNECTED',
        'No phones are connected. Please ensure TapKit is running and a phone is connected.'
      );
    }

    this.phoneId = phones[0].id;
    return this.phoneId;
  }

  /**
   * List all connected phones
   */
  async listPhones(): Promise<Phone[]> {
    return this.request<Phone[]>('GET', '/phones');
  }

  /**
   * Get a screenshot from the phone
   * Returns PNG image buffer
   */
  async screenshot(): Promise<Buffer> {
    const phoneId = await this.getPhoneId();
    return this.request<Buffer>('GET', `/phones/${phoneId}/screenshot`);
  }

  /**
   * Tap at specific coordinates
   */
  async tap(x: number, y: number): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/tap`, { x, y });
  }

  /**
   * Tap an element by natural language description
   */
  async tapElement(description: string): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/tap/select`, {
      description
    });
  }

  /**
   * Double tap at coordinates
   */
  async doubleTap(x: number, y: number): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/double-tap`, { x, y });
  }

  /**
   * Long press at coordinates
   */
  async longPress(x: number, y: number, duration?: number): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/tap-and-hold`, {
      x,
      y,
      duration: duration || 1000
    });
  }

  /**
   * Swipe/flick gesture
   */
  async swipe(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/flick`, {
      start_x: startX,
      start_y: startY,
      end_x: endX,
      end_y: endY,
    });
  }

  /**
   * Pan/scroll gesture (slower than swipe)
   */
  async scroll(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/pan`, {
      start_x: startX,
      start_y: startY,
      end_x: endX,
      end_y: endY,
    });
  }

  /**
   * Type text into active field
   */
  async typeText(text: string): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/type`, { text });
  }

  /**
   * Press home button
   */
  async pressHome(): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/home`, {});
  }

  /**
   * Open an app by name or bundle ID
   */
  async openApp(appName: string): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/open-app`, {
      app: appName
    });
  }

  /**
   * Lock the device
   */
  async lock(): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/lock`, {});
  }

  /**
   * Unlock the device
   */
  async unlock(): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/unlock`, {});
  }

  /**
   * Adjust volume up
   */
  async volumeUp(): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/volume-up`, {});
  }

  /**
   * Adjust volume down
   */
  async volumeDown(): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/volume-down`, {});
  }

  /**
   * Open Spotlight search
   */
  async spotlight(query?: string): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    const result = await this.request<TapResult>('POST', `/phones/${phoneId}/spotlight`, {});
    if (query) {
      await this.typeText(query);
    }
    return result;
  }

  /**
   * Activate Siri
   */
  async activateSiri(): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/siri`, {});
  }

  /**
   * Run an iOS Shortcut
   */
  async runShortcut(shortcutName: string): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/run-shortcut`, {
      shortcut: shortcutName
    });
  }

  /**
   * Open a URL on the device
   */
  async openUrl(url: string): Promise<TapResult> {
    const phoneId = await this.getPhoneId();
    return this.request<TapResult>('POST', `/phones/${phoneId}/open-url`, { url });
  }
}

export class TapKitAPIError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'TapKitAPIError';
    this.status = status;
    this.code = code;
  }

  toUserMessage(): string {
    switch (this.code) {
      case 'NO_PHONES_CONNECTED':
        return 'No phones connected. Please ensure TapKit is running and a phone is connected.';
      case 'PHONE_NOT_FOUND':
        return 'Phone not found. The device may have been disconnected.';
      case 'MAC_APP_NOT_RUNNING':
        return 'TapKit companion app is not running on your Mac.';
      case 'TIMEOUT':
        return 'Operation timed out. The app may be unresponsive.';
      case 'INVALID_API_KEY':
        return 'Invalid API key. Please check your TapKit credentials.';
      case 'AUTH_REQUIRED':
        return 'Authentication required. Please sign in to TapKit.';
      case 'SUBSCRIPTION_REQUIRED':
        return 'An active TapKit subscription is required.';
      case 'NETWORK_ERROR':
        return `Network error: ${this.message}`;
      case 'USER_NOT_FOUND':
        return 'User not found. Please ensure you have a TapKit account.';
      default:
        return `${this.code}: ${this.message}`;
    }
  }
}
